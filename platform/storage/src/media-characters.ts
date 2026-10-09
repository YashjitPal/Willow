/**
 * Media characters (Flow's Characters), per project.
 *
 * A database of its own, like `media-scenes.ts`, so adding it never bumps the version of a
 * database another module opens at a fixed version.
 *
 * A character holds no media bytes. Its portrait and body are gallery items (tagged with the
 * character's id, and kept out of the gallery grid), so they are saved, named and versioned like
 * every other generation; the character only records which version of each it shows.
 *
 * Keys are scoped like media records (user + root + workspace, see `chatScopeId`).
 */

const DB_NAME = 'WillowMediaCharactersDB';
const DB_VERSION = 1;
const STORE = 'characters';

export interface StoredCharacterVoice {
  /** One of Gemini's prebuilt voices, e.g. "Achernar". */
  name: string;
  sample?: string;
  performance?: string;
}

export interface StoredCharacter {
  id: string;
  /** Empty until the user names it; shown as "Untitled character". */
  name: string;
  createdAt: number;
  updatedAt: number;
  favorite?: boolean;
  /** "Character info": how the character acts, for the agent. */
  personality?: string;
  voice?: StoredCharacterVoice;
  /** The gallery item shown as the character's portrait, and as its body once made. */
  portraitId?: string;
  bodyId?: string;
  /** The description the character was made from. */
  prompt?: string;
}

interface CharacterRecord {
  key: string;
  character: StoredCharacter;
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
      reject(request.error ?? new Error('Failed to open the Media character store'));
    };
  });
  return dbPromise;
}

const projectPrefix = (scopeId: string, projectId: string): string =>
  `scope:${encodeURIComponent(scopeId)}:project:${encodeURIComponent(projectId)}:character:`;

const prefixRange = (prefix: string): IDBKeyRange => IDBKeyRange.bound(prefix, `${prefix}\uffff`);

const done = (tx: IDBTransaction, what: string): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`Failed to ${what}`));
    tx.onabort = () => reject(tx.error ?? new Error(`Aborted while trying to ${what}`));
  });

/** Every character saved for a project, oldest first. */
export async function listCharacters(projectId: string, scopeId: string): Promise<StoredCharacter[]> {
  if (!projectId) return [];
  const db = await openDB();
  const tx = db.transaction(STORE, 'readonly');
  const request = tx.objectStore(STORE).getAll(prefixRange(projectPrefix(scopeId, projectId)));
  const records = await new Promise<CharacterRecord[]>((resolve, reject) => {
    request.onsuccess = () => resolve((request.result || []) as CharacterRecord[]);
    request.onerror = () => reject(request.error ?? new Error('Failed to list Media characters'));
  });
  return records.map((r) => r.character).sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveCharacter(projectId: string, character: StoredCharacter, scopeId: string): Promise<void> {
  if (!projectId || !character.id) return;
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put({ key: projectPrefix(scopeId, projectId) + character.id, character } satisfies CharacterRecord);
  await done(tx, 'save the Media character');
}

export async function deleteCharacter(projectId: string, characterId: string, scopeId: string): Promise<void> {
  if (!projectId || !characterId) return;
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(projectPrefix(scopeId, projectId) + characterId);
  await done(tx, 'delete the Media character');
}

/** Removes every character of a project; called when the project itself is deleted. */
export async function deleteCharactersForProject(projectId: string, scopeId: string): Promise<void> {
  if (!projectId) return;
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(prefixRange(projectPrefix(scopeId, projectId)));
  await done(tx, "delete the project's Media characters");
}
