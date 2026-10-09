/**
 * Media collections (Flow's collections), per project.
 *
 * A collection is a folder: an item belongs to at most one, and while it is in one it is shown
 * there and not at the top of the project. Collections nest, as Flow's do: one can sit inside
 * another (`parentId`). On disk each collection is a folder of its own — `Media/<project>/<a>/`
 * at the top, `Media/<project>/<a>/<b>/` for one inside it — holding the media files of the items
 * inside it, so the folder tree and the app agree. The reconciler reads membership from where each
 * file actually is, and adopts a folder made on disk as a new collection.
 *
 * Records live in a database of their own, like `media-scenes.ts`. Keys are scoped like media
 * records (user + root + workspace, see `chatScopeId`).
 */

const DB_NAME = 'WillowMediaCollectionsDB';
const DB_VERSION = 1;
const STORE = 'collections';

export interface StoredCollection {
  id: string;
  name: string;
  /** The collection's own folder name, inside its parent's folder (or the project folder). */
  folder: string;
  /** The collection it sits inside; none for one at the top of the project. */
  parentId?: string;
  createdAt: number;
  updatedAt: number;
  favorite?: boolean;
  /** The item its tile shows first ("Set collection cover"); the newest one when unset or gone. */
  coverId?: string;
  /** Its folder has been seen on disk, so a later scan that misses it means it was deleted. */
  onDisk?: boolean;
}

/** Where a Media project keeps its agent chats: `<session>.json` and its files in `<session>/`. */
export const MEDIA_AGENT_SESSIONS_FOLDER = 'Agent sessions';

/** Folders a project folder already uses for itself; a collection never takes one of these. */
export const RESERVED_PROJECT_FOLDERS = new Set(['images', 'videos', 'audio', 'scenes', 'music', 'characters', MEDIA_AGENT_SESSIONS_FOLDER.toLowerCase()]);

/**
 * A folder name for a collection called `name`: safe on every filesystem and unique among
 * `taken` (its siblings' folders). At the top of the project it also avoids the project's own
 * folders; inside a collection those names are free.
 */
export function collectionFolderName(name: string, taken: Iterable<string>, topLevel = true): string {
  const base = name.replace(/[\\/:*?"<>|]/g, '').replace(/[. ]+$/, '').trim() || 'Untitled collection';
  const used = new Set([...taken].map((f) => f.toLowerCase()));
  let candidate = base;
  let n = 1;
  while (used.has(candidate.toLowerCase()) || (topLevel && RESERVED_PROJECT_FOLDERS.has(candidate.toLowerCase()))) {
    candidate = `${base} (${n})`;
    n += 1;
  }
  return candidate;
}

/**
 * Where a collection's folder is, from the project folder: its parents' folders and its own, joined
 * with "/" (no folder name can hold one). A parent missing from `byId`, or a loop, ends the walk.
 */
export function collectionPath(collection: StoredCollection, byId: ReadonlyMap<string, StoredCollection>): string {
  const segments: string[] = [];
  const seen = new Set<string>();
  for (let c: StoredCollection | undefined = collection; c && !seen.has(c.id); c = c.parentId ? byId.get(c.parentId) : undefined) {
    seen.add(c.id);
    segments.unshift(c.folder);
  }
  return segments.join('/');
}

interface CollectionRecord {
  key: string;
  collection: StoredCollection;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
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
      reject(request.error ?? new Error('Failed to open the Media collection store'));
    };
  });
  return dbPromise;
}

const projectPrefix = (scopeId: string, projectId: string): string =>
  `scope:${encodeURIComponent(scopeId)}:project:${encodeURIComponent(projectId)}:collection:`;

const prefixRange = (prefix: string): IDBKeyRange => IDBKeyRange.bound(prefix, `${prefix}\uffff`);

const done = (tx: IDBTransaction, what: string): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`Failed to ${what}`));
    tx.onabort = () => reject(tx.error ?? new Error(`Aborted while trying to ${what}`));
  });

/** Every collection saved for a project, oldest first. */
export async function listCollections(projectId: string, scopeId: string): Promise<StoredCollection[]> {
  if (!projectId) return [];
  const db = await openDB();
  const tx = db.transaction(STORE, 'readonly');
  const request = tx.objectStore(STORE).getAll(prefixRange(projectPrefix(scopeId, projectId)));
  const records = await new Promise<CollectionRecord[]>((resolve, reject) => {
    request.onsuccess = () => resolve((request.result || []) as CollectionRecord[]);
    request.onerror = () => reject(request.error ?? new Error('Failed to list Media collections'));
  });
  return records.map((r) => r.collection).sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveCollection(projectId: string, collection: StoredCollection, scopeId: string): Promise<void> {
  if (!projectId || !collection.id) return;
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put({ key: projectPrefix(scopeId, projectId) + collection.id, collection } satisfies CollectionRecord);
  await done(tx, 'save the Media collection');
}

export async function deleteCollection(projectId: string, collectionId: string, scopeId: string): Promise<void> {
  if (!projectId || !collectionId) return;
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(projectPrefix(scopeId, projectId) + collectionId);
  await done(tx, 'delete the Media collection');
}

/** Removes every collection of a project; called when the project itself is deleted. */
export async function deleteCollectionsForProject(projectId: string, scopeId: string): Promise<void> {
  if (!projectId) return;
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(prefixRange(projectPrefix(scopeId, projectId)));
  await done(tx, "delete the project's Media collections");
}

/** Broadcast when the reconciler adopted or dropped a collection, so the app re-reads them. */
export const COLLECTIONS_CHANGED_EVENT = 'willow_media_collections_changed';
