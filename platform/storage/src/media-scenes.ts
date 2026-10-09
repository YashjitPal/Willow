/**
 * Media scenes (Flow's Scenebuilder), per project.
 *
 * A database of its own for the same reason as `media-agent-sessions.ts`: a new store in
 * `WillowMediaDB` would need a version bump, and `media-storage.ts` opens that database at a
 * fixed version, so the first open at the new version would make every older open fail.
 *
 * A scene holds no media bytes. Its clips point at gallery items by id, and the only images
 * it carries are the small JPEG thumbnails its tile and timeline draw before the videos load.
 *
 * Keys are scoped like media records (user + root + workspace, see `chatScopeId`), so one
 * account's scenes never appear in another's project.
 */

const DB_NAME = 'WillowMediaScenesDB';
const DB_VERSION = 1;
const SCENES_STORE = 'scenes';

export interface StoredSceneClip {
  id: string;
  /** The gallery item this clip plays. */
  mediaId: string;
  /** Seconds into the source where the clip starts and ends. */
  trimStart: number;
  trimEnd: number;
  /** Length of the source, so a trim can be undone without reloading the video. */
  sourceDuration: number;
  /** One JPEG data URL of the clip's opening frame, drawn as the tile's filmstrip. */
  thumb?: string;
  /**
   * Where the clip's video was in the project folder ("Videos/X.mp4"), when the scene came from
   * its file there: how a clip whose video is missing here is found again.
   */
  file?: string;
}

export interface StoredScene {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  aspectRatio: '16:9' | '9:16';
  favorite?: boolean;
  /** Set while the scene sits in the trash; Undo clears it. */
  trashedAt?: number;
  clips: StoredSceneClip[];
  /** First frame of the first clip, for the tile before its video loads. */
  poster?: string;
  /** The scene's file in the project folder's Scenes/, once written there ("Scene Oct 3.json"). */
  fsName?: string;
}

interface SceneRecord {
  key: string;
  scene: StoredScene;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SCENES_STORE)) db.createObjectStore(SCENES_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Failed to open the Media scene store'));
    };
  });
  return dbPromise;
}

const projectPrefix = (scopeId: string, projectId: string): string =>
  `scope:${encodeURIComponent(scopeId)}:project:${encodeURIComponent(projectId)}:scene:`;

const sceneKey = (scopeId: string, projectId: string, sceneId: string): string =>
  projectPrefix(scopeId, projectId) + sceneId;

const prefixRange = (prefix: string): IDBKeyRange => IDBKeyRange.bound(prefix, `${prefix}\uffff`);

const done = (tx: IDBTransaction, what: string): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`Failed to ${what}`));
    tx.onabort = () => reject(tx.error ?? new Error(`Aborted while trying to ${what}`));
  });

/** Every scene saved for a project, trashed ones included, oldest first. */
export async function listScenes(projectId: string, scopeId: string): Promise<StoredScene[]> {
  if (!projectId) return [];
  const db = await openDB();
  const tx = db.transaction(SCENES_STORE, 'readonly');
  const request = tx.objectStore(SCENES_STORE).getAll(prefixRange(projectPrefix(scopeId, projectId)));
  const records = await new Promise<SceneRecord[]>((resolve, reject) => {
    request.onsuccess = () => resolve((request.result || []) as SceneRecord[]);
    request.onerror = () => reject(request.error ?? new Error('Failed to list Media scenes'));
  });
  return records.map((r) => r.scene).sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveScene(projectId: string, scene: StoredScene, scopeId: string): Promise<void> {
  if (!projectId || !scene.id) return;
  const db = await openDB();
  const tx = db.transaction(SCENES_STORE, 'readwrite');
  tx.objectStore(SCENES_STORE).put({ key: sceneKey(scopeId, projectId, scene.id), scene } satisfies SceneRecord);
  await done(tx, 'save the Media scene');
}

export async function deleteScene(projectId: string, sceneId: string, scopeId: string): Promise<void> {
  if (!projectId || !sceneId) return;
  const db = await openDB();
  const tx = db.transaction(SCENES_STORE, 'readwrite');
  tx.objectStore(SCENES_STORE).delete(sceneKey(scopeId, projectId, sceneId));
  await done(tx, 'delete the Media scene');
}

/** Removes every scene of a project; called when the project itself is deleted. */
export async function deleteScenesForProject(projectId: string, scopeId: string): Promise<void> {
  if (!projectId) return;
  const db = await openDB();
  const tx = db.transaction(SCENES_STORE, 'readwrite');
  tx.objectStore(SCENES_STORE).delete(prefixRange(projectPrefix(scopeId, projectId)));
  await done(tx, "delete the project's Media scenes");
}
