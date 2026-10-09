/**
 * Media tools (Flow's Tools tab): the user's own tools, every saved version of each, the Tool
 * Builder conversation per tool, the user's favorites and pins (which may name a template or a
 * community tool as well), and each tool's own storage — `Flow.storage` and its localStorage.
 *
 * A database of its own for the same reason as `media-scenes.ts`: a new store in `WillowMediaDB`
 * would need a version bump that breaks its fixed-version opens.
 *
 * Tools belong to the account, not to a project, as Flow's do: keys are scoped by `chatScopeId`
 * (user + root + workspace) only. Templates and community tools are not stored here; they ship
 * with the app (`features/media/src/tools/catalog/`).
 *
 * With a folder connected, each own tool also has a file in its `Media/Tools/`
 * (`features/media/src/tools/tools-disk.ts`), which is why every write here is announced
 * (`onMediaToolsChange`) and why a tool can be put back whole (`replaceTool`).
 */

const DB_NAME = 'WillowMediaToolsDB';
const DB_VERSION = 1;
const TOOLS = 'tools';
const VERSIONS = 'versions';
const CHATS = 'chats';
const PREFS = 'prefs';
const KV = 'kv';

export interface StoredToolFile {
  path: string;
  content: string;
}

export interface StoredTool {
  id: string;
  name: string;
  description: string;
  /** A preset's URL or an uploaded picture as a data URL. */
  icon: string;
  /** The gallery card's picture (Set cover / Add preview image), when one was chosen. */
  cover?: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt?: number;
  /** The version the tool runs. */
  versionId: string;
  /** Where a remix came from. */
  remixedFrom?: { id: string; name: string; kind: 'template' | 'community' | 'self' };
  allowRemixing?: boolean;
  /** Set once Apply to be featured was submitted. */
  featuredRequest?: { email: string; displayName: string; submittedAt: number };
  /** Made from Create tool and still on its first Tool Builder turn: listed nowhere until that turn saves a version. */
  pending?: boolean;
}

export interface StoredToolVersion {
  id: string;
  toolId: string;
  createdAt: number;
  files: StoredToolFile[];
  /** What made it: the first build, a builder turn, a restore, a remix, an import. */
  origin: 'create' | 'edit' | 'restore' | 'remix' | 'import';
}

export interface StoredToolChatMessage {
  id: string;
  /** `reverted` marks a Restore: "Restored from", with the prompt whose version came back. */
  role: 'user' | 'agent' | 'reverted';
  text: string;
  createdAt: number;
  /** The agent's thought summary for the turn, shown in its chip. */
  thoughts?: string;
  /** The chip's label: the summary's newest heading. */
  thoughtTitle?: string;
  /** The version this turn produced, which Restore returns to. */
  versionId?: string;
  /** "Edited /App.tsx; created /components/Grid.tsx", for the next turns' history. */
  changes?: string;
  status?: 'done' | 'error' | 'stopped';
  error?: string;
  feedback?: 'up' | 'down';
  /** On a `reverted` mark: the prompt that made the restored version. */
  restoredPrompt?: string;
}

export interface StoredToolPrefs {
  favorites: string[];
  pins: string[];
  /** Tools opened lately, newest first: the dock lists them after the pinned ones. */
  recent?: string[];
  /** Whether the sidebar's Tools list is open. */
  dockOpen?: boolean;
  /** The manager page's tab, as Flow keeps it. */
  activeTab?: 'MY_APPS' | 'COMMUNITY' | 'GALLERY';
  /** The Tool Builder panel's width. */
  panelWidth?: number;
}

/** A write to this store. */
export interface MediaToolsChange {
  scopeId: string;
  /** Null for the account's preferences. */
  toolId: string | null;
  what: 'tool' | 'version' | 'chat' | 'storage' | 'prefs' | 'deleted';
  /** Made from the folder (the Tools folder's sync, or settings.json), which must not take it for work to write out. */
  fromDisk?: boolean;
}

const changeListeners = new Set<(change: MediaToolsChange) => void>();

/** Every write, once it has landed. Returns the unsubscribe. */
export function onMediaToolsChange(listener: (change: MediaToolsChange) => void): () => void {
  changeListeners.add(listener);
  return () => { changeListeners.delete(listener); };
}

const announce = (change: MediaToolsChange): void => {
  for (const listener of changeListeners) {
    try { listener(change); } catch (error) { console.warn('[tools] a change listener failed', error); }
  }
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of [TOOLS, VERSIONS, CHATS, PREFS, KV]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'key' });
      }
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
      reject(request.error ?? new Error('Failed to open the Media tools store'));
    };
  });
  return dbPromise;
}

const scope = (scopeId: string): string => `scope:${encodeURIComponent(scopeId)}:`;
const toolKey = (scopeId: string, toolId: string): string => `${scope(scopeId)}tool:${toolId}`;
const versionPrefix = (scopeId: string, toolId: string): string => `${toolKey(scopeId, toolId)}:version:`;
const kvPrefix = (scopeId: string, toolId: string): string => `${toolKey(scopeId, toolId)}:kv:`;
const prefixRange = (prefix: string): IDBKeyRange => IDBKeyRange.bound(prefix, `${prefix}\uffff`);

const done = (tx: IDBTransaction, what: string): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`Failed to ${what}`));
    tx.onabort = () => reject(tx.error ?? new Error(`Aborted while trying to ${what}`));
  });

function read<T>(request: IDBRequest, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error ?? new Error(`Failed to ${what}`));
  });
}

/** Every tool of the account, newest first. */
export async function listTools(scopeId: string): Promise<StoredTool[]> {
  const db = await openDB();
  const store = db.transaction(TOOLS, 'readonly').objectStore(TOOLS);
  const records = await read<{ key: string; tool: StoredTool }[]>(store.getAll(prefixRange(`${scope(scopeId)}tool:`)), 'list Media tools');
  return records.filter((r) => !r.key.includes(':version:') && !r.key.includes(':kv:')).map((r) => r.tool).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadTool(toolId: string, scopeId: string): Promise<StoredTool | null> {
  const db = await openDB();
  const store = db.transaction(TOOLS, 'readonly').objectStore(TOOLS);
  const record = await read<{ tool: StoredTool } | undefined>(store.get(toolKey(scopeId, toolId)), 'load the Media tool');
  return record?.tool ?? null;
}

export async function saveTool(tool: StoredTool, scopeId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(TOOLS, 'readwrite');
  tx.objectStore(TOOLS).put({ key: toolKey(scopeId, tool.id), tool });
  await done(tx, 'save the Media tool');
  announce({ scopeId, toolId: tool.id, what: 'tool' });
}

/** Removes a tool with its versions, conversation and storage. */
export async function deleteTool(toolId: string, scopeId: string, options: { fromDisk?: boolean } = {}): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([TOOLS, VERSIONS, CHATS, KV], 'readwrite');
  tx.objectStore(TOOLS).delete(toolKey(scopeId, toolId));
  tx.objectStore(VERSIONS).delete(prefixRange(versionPrefix(scopeId, toolId)));
  tx.objectStore(CHATS).delete(toolKey(scopeId, toolId));
  tx.objectStore(KV).delete(prefixRange(kvPrefix(scopeId, toolId)));
  await done(tx, 'delete the Media tool');
  announce({ scopeId, toolId, what: 'deleted', ...(options.fromDisk ? { fromDisk: true } : {}) });
}

export async function saveToolVersion(version: StoredToolVersion, scopeId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(VERSIONS, 'readwrite');
  tx.objectStore(VERSIONS).put({ key: versionPrefix(scopeId, version.toolId) + version.id, version });
  await done(tx, 'save the Media tool version');
  announce({ scopeId, toolId: version.toolId, what: 'version' });
}

/** Every saved version of a tool, oldest first. */
export async function listToolVersions(toolId: string, scopeId: string): Promise<StoredToolVersion[]> {
  const db = await openDB();
  const store = db.transaction(VERSIONS, 'readonly').objectStore(VERSIONS);
  const records = await read<{ version: StoredToolVersion }[]>(store.getAll(prefixRange(versionPrefix(scopeId, toolId))), 'list the Media tool versions');
  return records.map((r) => r.version).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** A tool with all it has, as the Tools folder keeps it. */
export interface StoredToolRecord {
  tool: StoredTool;
  versions: StoredToolVersion[];
  chat: StoredToolChatMessage[];
  /** `Flow.storage`'s keys. */
  storage: Record<string, unknown>;
  localStorage: Record<string, string>;
}

/** Puts a tool back as a copy of it holds it, in place of whatever this store had of it. */
export async function replaceTool(record: StoredToolRecord, scopeId: string): Promise<void> {
  const id = record.tool.id;
  const db = await openDB();
  const tx = db.transaction([TOOLS, VERSIONS, CHATS, KV], 'readwrite');
  tx.objectStore(TOOLS).put({ key: toolKey(scopeId, id), tool: record.tool });
  const versions = tx.objectStore(VERSIONS);
  versions.delete(prefixRange(versionPrefix(scopeId, id)));
  for (const version of record.versions) versions.put({ key: versionPrefix(scopeId, id) + version.id, version: { ...version, toolId: id } });
  tx.objectStore(CHATS).put({ key: toolKey(scopeId, id), messages: record.chat });
  const kv = tx.objectStore(KV);
  kv.delete(prefixRange(kvPrefix(scopeId, id)));
  for (const [key, value] of Object.entries(record.storage)) {
    if (key !== LOCAL_STORAGE_KEY) kv.put({ key: kvPrefix(scopeId, id) + key, value });
  }
  if (Object.keys(record.localStorage).length) kv.put({ key: kvPrefix(scopeId, id) + LOCAL_STORAGE_KEY, value: record.localStorage });
  await done(tx, 'put the Media tool back');
  announce({ scopeId, toolId: id, what: 'tool', fromDisk: true });
}

/** The Tools folder's own bookkeeping for a scope: the file each tool is in, and the name it was named for. */
export interface ToolsDiskState {
  files: Record<string, { file: string; name: string }>;
}

/** Null until the folder's first pass in this database. */
export async function loadToolsDiskState(scopeId: string): Promise<ToolsDiskState | null> {
  const db = await openDB();
  const store = db.transaction(PREFS, 'readonly').objectStore(PREFS);
  const record = await read<{ state: ToolsDiskState } | undefined>(store.get(`${scope(scopeId)}disk`), 'load the Tools folder state');
  return record?.state ? { files: { ...record.state.files } } : null;
}

export async function saveToolsDiskState(state: ToolsDiskState, scopeId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(PREFS, 'readwrite');
  tx.objectStore(PREFS).put({ key: `${scope(scopeId)}disk`, state });
  await done(tx, 'save the Tools folder state');
}

export async function loadToolVersion(toolId: string, versionId: string, scopeId: string): Promise<StoredToolVersion | null> {
  const db = await openDB();
  const store = db.transaction(VERSIONS, 'readonly').objectStore(VERSIONS);
  const record = await read<{ version: StoredToolVersion } | undefined>(store.get(versionPrefix(scopeId, toolId) + versionId), 'load the Media tool version');
  return record?.version ?? null;
}

export async function loadToolChat(toolId: string, scopeId: string): Promise<StoredToolChatMessage[]> {
  const db = await openDB();
  const store = db.transaction(CHATS, 'readonly').objectStore(CHATS);
  const record = await read<{ messages: StoredToolChatMessage[] } | undefined>(store.get(toolKey(scopeId, toolId)), 'load the Tool Builder chat');
  return record?.messages ?? [];
}

export async function saveToolChat(toolId: string, messages: StoredToolChatMessage[], scopeId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(CHATS, 'readwrite');
  tx.objectStore(CHATS).put({ key: toolKey(scopeId, toolId), messages });
  await done(tx, 'save the Tool Builder chat');
  announce({ scopeId, toolId, what: 'chat' });
}

export async function loadToolPrefs(scopeId: string): Promise<StoredToolPrefs> {
  return { favorites: [], pins: [], ...(await loadSavedToolPrefs(scopeId)) };
}

/** The scope's preferences as saved, or null when it never saved any. */
export async function loadSavedToolPrefs(scopeId: string): Promise<StoredToolPrefs | null> {
  const db = await openDB();
  const store = db.transaction(PREFS, 'readonly').objectStore(PREFS);
  const record = await read<{ prefs: StoredToolPrefs } | undefined>(store.get(`${scope(scopeId)}prefs`), 'load the Media tool preferences');
  return record?.prefs ? { favorites: [], pins: [], ...record.prefs } : null;
}

/** `fromDisk` for preferences taken from `settings.json`, which the open Tools pages then show. */
export async function saveToolPrefs(prefs: StoredToolPrefs, scopeId: string, options?: { fromDisk: true }): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(PREFS, 'readwrite');
  tx.objectStore(PREFS).put({ key: `${scope(scopeId)}prefs`, prefs });
  await done(tx, 'save the Media tool preferences');
  announce({ scopeId, toolId: null, what: 'prefs', ...(options?.fromDisk ? { fromDisk: true } : {}) });
}

/* ------------------------------------------------------------------ *
 * A tool's own storage: `Flow.storage`'s keys, and its localStorage as one reserved key that
 * `Flow.storage` never lists. Any tool may have storage, a template or a community one included.
 * ------------------------------------------------------------------ */

const LOCAL_STORAGE_KEY = '\u0000localStorage';

export async function toolKvGet(toolId: string, key: string, scopeId: string): Promise<unknown> {
  const db = await openDB();
  const store = db.transaction(KV, 'readonly').objectStore(KV);
  const record = await read<{ value: unknown } | undefined>(store.get(kvPrefix(scopeId, toolId) + key), 'read the tool storage');
  return record?.value ?? null;
}

export async function toolKvSet(toolId: string, key: string, value: unknown, scopeId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(KV, 'readwrite');
  tx.objectStore(KV).put({ key: kvPrefix(scopeId, toolId) + key, value });
  await done(tx, 'write the tool storage');
  announce({ scopeId, toolId, what: 'storage' });
}

export async function toolKvRemove(toolId: string, key: string, scopeId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(KV, 'readwrite');
  tx.objectStore(KV).delete(kvPrefix(scopeId, toolId) + key);
  await done(tx, 'remove from the tool storage');
  announce({ scopeId, toolId, what: 'storage' });
}

/** Everything a tool stored: `Flow.storage`'s keys, and its localStorage apart. */
export async function readToolStorage(toolId: string, scopeId: string): Promise<{ storage: Record<string, unknown>; localStorage: Record<string, string> }> {
  const db = await openDB();
  const store = db.transaction(KV, 'readonly').objectStore(KV);
  const records = await read<{ key: string; value: unknown }[]>(store.getAll(prefixRange(kvPrefix(scopeId, toolId))), 'read the tool storage');
  const start = kvPrefix(scopeId, toolId).length;
  const storage: Record<string, unknown> = {};
  let localStorage: Record<string, string> = {};
  for (const record of records) {
    const key = record.key.slice(start);
    if (key !== LOCAL_STORAGE_KEY) storage[key] = record.value;
    else if (record.value && typeof record.value === 'object') localStorage = record.value as Record<string, string>;
  }
  return { storage, localStorage };
}

/** Flow.storage.clear(): every key but the localStorage snapshot. */
export async function toolKvClear(toolId: string, scopeId: string, options: { includeLocalStorage?: boolean } = {}): Promise<void> {
  const db = await openDB();
  const keep = options.includeLocalStorage ? null : await toolKvGet(toolId, LOCAL_STORAGE_KEY, scopeId);
  const tx = db.transaction(KV, 'readwrite');
  const store = tx.objectStore(KV);
  store.delete(prefixRange(kvPrefix(scopeId, toolId)));
  if (keep) store.put({ key: kvPrefix(scopeId, toolId) + LOCAL_STORAGE_KEY, value: keep });
  await done(tx, 'clear the tool storage');
  announce({ scopeId, toolId, what: 'storage' });
}

export async function toolKvKeys(toolId: string, scopeId: string, prefix = ''): Promise<string[]> {
  const db = await openDB();
  const store = db.transaction(KV, 'readonly').objectStore(KV);
  const keys = await read<IDBValidKey[]>(store.getAllKeys(prefixRange(kvPrefix(scopeId, toolId))), 'list the tool storage');
  const start = kvPrefix(scopeId, toolId).length;
  return keys.map((k) => String(k).slice(start)).filter((k) => k !== LOCAL_STORAGE_KEY && k.startsWith(prefix));
}

export async function loadToolLocalStorage(toolId: string, scopeId: string): Promise<Record<string, string>> {
  const value = await toolKvGet(toolId, LOCAL_STORAGE_KEY, scopeId);
  return value && typeof value === 'object' ? (value as Record<string, string>) : {};
}

export async function saveToolLocalStorage(toolId: string, entries: Record<string, string>, scopeId: string): Promise<void> {
  await toolKvSet(toolId, LOCAL_STORAGE_KEY, entries, scopeId);
}
