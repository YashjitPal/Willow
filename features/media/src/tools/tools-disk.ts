/**
 * The Tools folder: each tool of your own as one file in the connected folder's `Media/Tools/`,
 * beside the projects rather than in one, since a tool belongs to the account and not to a
 * project. A browser whose site data was cleared, or another browser on the same folder, gets
 * every tool back from it.
 *
 * A file holds what it takes to bring a tool back whole: its details, every version's files
 * (Restore goes back to old ones), the Tool Builder conversation and what the tool itself stored.
 * A tool still on its first build (`pending`) gets a file once that build saves a version.
 *
 * The synced-folder engine does the syncing (platform/storage/ARCHITECTURE.md §13); this says
 * what a file is. The engine knows an item by its file name, so:
 * - A file is named after its tool, "Pixel Sketch.tool.json", and the name it got is kept per
 *   tool (`ToolsDiskState`): renamed by hand, it keeps the new name; the tool renamed here, it
 *   moves to a file of the new one.
 * - The id inside a file is the tool's. A second file claiming a tool another file holds (a copy
 *   made by hand, the engine's "(Disk conflict …)" copy) becomes a tool of its own.
 * - A file that can't be read leaves its tool as it is here, and the next pass writes it back.
 * - The engine keeps a tombstone for every file it removed, forever, and takes no item of that
 *   name again: a tool never gets a name the engine holds any record of ("Sketch (2)" when a
 *   deleted tool had "Sketch"), and an item it refused is no evidence the tool's file is gone.
 *   Only a file it knew alive and lost is a deletion.
 * - A database without its bookkeeping, while the engine remembers files, is one that was cleared:
 *   the engine's records are dropped so the folder is read as a new browser reads it, instead of
 *   every tool missing here being taken for one deleted here.
 */
import {
  requestSyncedFolderPass,
  syncedFolderKeys,
  type SyncedFolderDescriptor,
  type SyncedItem,
} from '@willow/storage/local-sync';
import { safeFileStem } from '@willow/storage/local-fs/conversation-files';
import type {
  MediaToolsChange,
  StoredTool,
  StoredToolChatMessage,
  StoredToolRecord,
  StoredToolVersion,
  ToolsDiskState,
} from '@willow/storage/media-tools';

export const TOOLS_FOLDER = 'Media/Tools';
export const TOOL_FILE_EXTENSION = '.tool.json';

/** The format this writes; a file declaring another is still read for the fields it shares. */
const FORMAT = 1;
const UNTITLED = 'Untitled applet';
/** A change waits this long for the ones that follow it (a turn saves a version, then the tool). */
const PASS_DELAY_MS = 1500;
/** A running tool may store on every keystroke: that much is left to the regular polls. */
const STORAGE_PASS_DELAY_MS = 10_000;

/** What the folder needs of the tools database: `@willow/storage/media-tools`, or a stand-in. */
export interface ToolsDiskStore {
  listTools(scopeId: string): Promise<StoredTool[]>;
  listToolVersions(toolId: string, scopeId: string): Promise<StoredToolVersion[]>;
  loadToolChat(toolId: string, scopeId: string): Promise<StoredToolChatMessage[]>;
  readToolStorage(toolId: string, scopeId: string): Promise<{ storage: Record<string, unknown>; localStorage: Record<string, string> }>;
  replaceTool(record: StoredToolRecord, scopeId: string): Promise<void>;
  deleteTool(toolId: string, scopeId: string, options: { fromDisk: true }): Promise<void>;
  loadToolsDiskState(scopeId: string): Promise<ToolsDiskState | null>;
  saveToolsDiskState(state: ToolsDiskState, scopeId: string): Promise<void>;
  onMediaToolsChange(listener: (change: MediaToolsChange) => void): () => void;
}

/* ------------------------------------------------------------------ *
 * The file
 * ------------------------------------------------------------------ */

const sortedRecord = <T,>(value: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));

/** A tool's file. The same tool always comes out the same, or every pass would write it again. */
export function serializeToolFile(record: StoredToolRecord): string {
  const { tool } = record;
  const versions = [...record.versions].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return `${JSON.stringify({
    willowTool: FORMAT,
    id: tool.id,
    name: tool.name,
    description: tool.description,
    icon: tool.icon,
    ...(tool.cover ? { cover: tool.cover } : {}),
    createdAt: tool.createdAt,
    updatedAt: tool.updatedAt,
    versionId: tool.versionId,
    ...(tool.remixedFrom ? { remixedFrom: tool.remixedFrom } : {}),
    ...(tool.allowRemixing !== undefined ? { allowRemixing: tool.allowRemixing } : {}),
    ...(tool.featuredRequest ? { featuredRequest: tool.featuredRequest } : {}),
    versions: versions.map((v) => ({
      id: v.id,
      createdAt: v.createdAt,
      origin: v.origin,
      files: v.files.map((f) => ({ path: f.path, content: f.content })),
    })),
    chat: record.chat,
    storage: sortedRecord(record.storage),
    localStorage: sortedRecord(record.localStorage),
  }, null, 2)}\n`;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const time = (value: unknown, fallback: number): number =>
  (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

const ORIGINS = new Set<StoredToolVersion['origin']>(['create', 'edit', 'restore', 'remix', 'import']);
const ROLES = new Set<StoredToolChatMessage['role']>(['user', 'agent', 'reverted']);
const MESSAGE_TEXT_FIELDS = new Set(['thoughts', 'thoughtTitle', 'versionId', 'changes', 'error', 'restoredPrompt']);
const REMIX_KINDS = new Set(['template', 'community', 'self']);

const parseVersion = (raw: unknown, toolId: string, now: number): StoredToolVersion | null => {
  if (!isObject(raw) || typeof raw.id !== 'string' || !raw.id || !Array.isArray(raw.files)) return null;
  const files = raw.files
    .filter((f): f is { path: string; content: string } => isObject(f) && typeof f.path === 'string' && typeof f.content === 'string')
    .map((f) => ({ path: f.path, content: f.content }));
  const origin = ORIGINS.has(raw.origin as StoredToolVersion['origin']) ? (raw.origin as StoredToolVersion['origin']) : 'import';
  return { id: raw.id, toolId, createdAt: time(raw.createdAt, now), files, origin };
};

/** A message keeps its fields in the order the file has them, so putting one back changes no bytes. */
const parseMessage = (raw: unknown): StoredToolChatMessage | null => {
  if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.text !== 'string' || !ROLES.has(raw.role as StoredToolChatMessage['role'])) return null;
  const message: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'id' || key === 'role' || key === 'text') message[key] = value;
    else if (key === 'createdAt') message[key] = time(value, 0);
    else if (MESSAGE_TEXT_FIELDS.has(key) && typeof value === 'string') message[key] = value;
    else if (key === 'status' && (value === 'done' || value === 'error' || value === 'stopped')) message[key] = value;
    else if (key === 'feedback' && (value === 'up' || value === 'down')) message[key] = value;
  }
  if (typeof message.createdAt !== 'number') message.createdAt = 0;
  return message as unknown as StoredToolChatMessage;
};

/**
 * A file's tool, or null for one that is not a readable tool file. The folder is the user's to
 * edit, so nothing in a file is taken on trust.
 */
export function parseToolFile(contents: string): StoredToolRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch {
    return null;
  }
  if (!isObject(raw) || typeof raw.willowTool !== 'number' || raw.willowTool < 1) return null;
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null;
  const id = raw.id;
  const now = Date.now();
  const versions = (Array.isArray(raw.versions) ? raw.versions : [])
    .map((v) => parseVersion(v, id, now))
    .filter((v): v is StoredToolVersion => v !== null);
  if (!versions.length) return null;
  const versionId = typeof raw.versionId === 'string' && versions.some((v) => v.id === raw.versionId)
    ? raw.versionId
    : versions[versions.length - 1].id;
  const remixedFrom = isObject(raw.remixedFrom) && typeof raw.remixedFrom.id === 'string' && typeof raw.remixedFrom.name === 'string' && REMIX_KINDS.has(raw.remixedFrom.kind as string)
    ? { id: raw.remixedFrom.id, name: raw.remixedFrom.name, kind: raw.remixedFrom.kind as 'template' | 'community' | 'self' }
    : undefined;
  const featured = isObject(raw.featuredRequest) && typeof raw.featuredRequest.email === 'string' && typeof raw.featuredRequest.displayName === 'string'
    ? { email: raw.featuredRequest.email, displayName: raw.featuredRequest.displayName, submittedAt: time(raw.featuredRequest.submittedAt, now) }
    : undefined;
  const tool: StoredTool = {
    id,
    name: text(raw.name),
    description: text(raw.description),
    icon: text(raw.icon),
    ...(text(raw.cover) ? { cover: text(raw.cover) } : {}),
    createdAt: time(raw.createdAt, now),
    updatedAt: time(raw.updatedAt, now),
    versionId,
    ...(remixedFrom ? { remixedFrom } : {}),
    ...(typeof raw.allowRemixing === 'boolean' ? { allowRemixing: raw.allowRemixing } : {}),
    ...(featured ? { featuredRequest: featured } : {}),
  };
  const chat = (Array.isArray(raw.chat) ? raw.chat : [])
    .map(parseMessage)
    .filter((m): m is StoredToolChatMessage => m !== null);
  const storage = isObject(raw.storage) ? { ...raw.storage } : {};
  const localStorage = isObject(raw.localStorage)
    ? Object.fromEntries(Object.entries(raw.localStorage).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : {};
  return { tool, versions, chat, storage, localStorage };
}

/* ------------------------------------------------------------------ *
 * The engine's own records, for telling a cleared database from deletions
 * ------------------------------------------------------------------ */

const webStorage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/** The files the engine knows in this scope's folder. */
const engineIds = (scopeId: string): string[] => {
  try {
    const ids = JSON.parse(webStorage()?.getItem(syncedFolderKeys(TOOLS_FOLDER, scopeId).ids) ?? '[]');
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

/**
 * Every file name the engine has a record of, lowercased, and whether it is a tombstone. Read
 * during `applyRemote` these are the last pass's: the driver saves this pass's after it.
 */
const engineRecords = (scopeId: string): Map<string, { tombstone: boolean }> => {
  const out = new Map<string, { tombstone: boolean }>();
  try {
    const records = JSON.parse(webStorage()?.getItem(syncedFolderKeys(TOOLS_FOLDER, scopeId).sync) ?? '{}');
    if (isObject(records)) {
      for (const [id, record] of Object.entries(records)) {
        const tombstone = isObject(record) && record.tombstone === true;
        const key = id.toLowerCase();
        out.set(key, { tombstone: tombstone || out.get(key)?.tombstone === true });
      }
    }
  } catch {
    // Unreadable records: no name is known taken, and nothing below counts as deleted.
  }
  return out;
};

const forgetEngineRecords = (scopeId: string): void => {
  const storage = webStorage();
  if (!storage) return;
  for (const key of Object.values(syncedFolderKeys(TOOLS_FOLDER, scopeId))) {
    try { storage.removeItem(key); } catch { /* the next pass tries again */ }
  }
};

const newToolId = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `tool-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

/* ------------------------------------------------------------------ *
 * The folder
 * ------------------------------------------------------------------ */

/**
 * The `Media/Tools` descriptor over `store`. `dispose` stops it following the store's writes.
 * `requestPass` is how a local change asks for a pass sooner than the next poll.
 */
export function toolsFolderDescriptor(
  store: ToolsDiskStore,
  options: { requestPass?: () => void } = {},
): { descriptor: SyncedFolderDescriptor; dispose: () => void } {
  const keyOf = (scopeId: string, toolId: string) => `${scopeId}\u0000${toolId}`;
  /** Bumped by every write to a tool, so a file read out across one is not kept. */
  const generations = new Map<string, number>();
  const written = new Map<string, { generation: number; contents: string }>();
  /** Per scope, the last pass's `readLocal`: each tool's file, and what it gave under each file. */
  const lastRead = new Map<string, { fileOf: Map<string, string>; contents: Map<string, string> }>();

  let timer: ReturnType<typeof setTimeout> | null = null;
  let dueAt = 0;
  const schedulePass = (delay: number) => {
    const at = Date.now() + delay;
    if (timer && dueAt <= at) return;
    if (timer) clearTimeout(timer);
    dueAt = at;
    timer = setTimeout(() => {
      timer = null;
      (options.requestPass ?? requestSyncedFolderPass)();
    }, delay);
  };

  const unsubscribe = store.onMediaToolsChange((change) => {
    if (change.toolId) {
      const key = keyOf(change.scopeId, change.toolId);
      generations.set(key, (generations.get(key) ?? 0) + 1);
      written.delete(key);
    }
    if (change.fromDisk || change.what === 'prefs') return;
    schedulePass(change.what === 'storage' ? STORAGE_PASS_DELAY_MS : PASS_DELAY_MS);
  });

  const contentsOf = async (scopeId: string, tool: StoredTool): Promise<string> => {
    const key = keyOf(scopeId, tool.id);
    const generation = generations.get(key) ?? 0;
    const known = written.get(key);
    if (known && known.generation === generation) return known.contents;
    const [versions, chat, kept] = await Promise.all([
      store.listToolVersions(tool.id, scopeId),
      store.loadToolChat(tool.id, scopeId),
      store.readToolStorage(tool.id, scopeId),
    ]);
    const contents = serializeToolFile({ tool, versions, chat, storage: kept.storage, localStorage: kept.localStorage });
    if ((generations.get(key) ?? 0) === generation) written.set(key, { generation, contents });
    return contents;
  };

  const descriptor: SyncedFolderDescriptor = {
    folder: TOOLS_FOLDER,
    extension: TOOL_FILE_EXTENSION,

    async readLocal({ scopeId }): Promise<SyncedItem[]> {
      let state = await store.loadToolsDiskState(scopeId);
      if (!state) {
        state = { files: {} };
        await store.saveToolsDiskState(state, scopeId);
        if (engineIds(scopeId).length) {
          forgetEngineRecords(scopeId);
          // Throwing makes this pass a no-op; the next one starts from the folder.
          throw new Error('[tools] the tools database was cleared; reading the Tools folder afresh');
        }
      }

      // The older tool keeps the plain name when two share one.
      const tools = (await store.listTools(scopeId))
        .filter((t) => !t.pending)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      const present = new Set(tools.map((t) => t.id));
      let stateChanged = false;
      for (const id of Object.keys(state.files)) {
        if (!present.has(id)) {
          delete state.files[id];
          stateChanged = true;
        }
      }

      // Names in use: every file the engine has a record of (tombstones, strays and conflict
      // copies among them) and every tool's.
      const records = engineRecords(scopeId);
      const known = new Set([...records.keys(), ...engineIds(scopeId).map((n) => n.toLowerCase())]);
      const holder = new Map(Object.entries(state.files).map(([toolId, entry]) => [entry.file.toLowerCase(), toolId] as const));
      const fileOf = new Map<string, string>();
      const contents = new Map<string, string>();
      for (const tool of tools) {
        let entry = state.files[tool.id];
        const dead = !!entry && records.get(entry.file.toLowerCase())?.tombstone === true;
        if (!entry || dead || entry.name !== tool.name) {
          const own = entry && !dead ? entry.file.toLowerCase() : undefined;
          const free = (stem: string) => {
            const key = stem.toLowerCase();
            return key === own || (!known.has(key) && !holder.has(key));
          };
          const base = safeFileStem(tool.name || UNTITLED, UNTITLED);
          let stem = base;
          for (let n = 2; !free(stem); n += 1) stem = `${base} (${n})`;
          if (entry && entry.file.toLowerCase() !== stem.toLowerCase()) holder.delete(entry.file.toLowerCase());
          holder.set(stem.toLowerCase(), tool.id);
          entry = { file: stem, name: tool.name };
          state.files[tool.id] = entry;
          stateChanged = true;
        }
        fileOf.set(tool.id, entry.file);
        contents.set(entry.file, await contentsOf(scopeId, tool));
      }
      if (stateChanged) await store.saveToolsDiskState(state, scopeId);
      lastRead.set(scopeId, { fileOf, contents });
      return [...contents].map(([id, text]) => ({ id, contents: text }));
    },

    async applyRemote(items, { scopeId }): Promise<void> {
      const state = (await store.loadToolsDiskState(scopeId)) ?? { files: {} };
      const local = new Map((await store.listTools(scopeId)).map((t) => [t.id, t] as const));
      const read = lastRead.get(scopeId);
      const ownerOf = new Map(Object.entries(state.files).map(([toolId, entry]) => [entry.file.toLowerCase(), toolId] as const));
      const onDisk = new Set(items.map((item) => item.id.toLowerCase()));
      /** Tools that still have a file. */
      const kept = new Set<string>();
      const arrived: Array<{ item: SyncedItem; record: StoredToolRecord }> = [];
      for (const item of items) {
        const owner = ownerOf.get(item.id.toLowerCase());
        if (read?.contents.get(item.id) === item.contents) {
          if (owner) kept.add(owner);
          continue;
        }
        const record = parseToolFile(item.contents);
        if (!record) {
          if (owner) kept.add(owner);
          continue;
        }
        arrived.push({ item, record });
      }

      // A tool's own file before anything else claiming the tool.
      const isHome = ({ item, record }: { item: SyncedItem; record: StoredToolRecord }) =>
        state.files[record.tool.id]?.file.toLowerCase() === item.id.toLowerCase();
      arrived.sort((a, b) => Number(isHome(b)) - Number(isHome(a)) || a.item.id.localeCompare(b.item.id));

      let stateChanged = false;
      for (const { item, record } of arrived) {
        const home = state.files[record.tool.id]?.file.toLowerCase();
        // Claimed already, or its own file is still there: this one is a copy, and a tool of its own.
        const copy = kept.has(record.tool.id) || (home !== undefined && home !== item.id.toLowerCase() && onDisk.has(home));
        const id = copy ? newToolId() : record.tool.id;
        const previous = local.get(id);
        const name = copy && item.id.includes(' (Disk conflict ') ? `${record.tool.name} (disk conflict)` : record.tool.name;
        const tool: StoredTool = { ...record.tool, id, name, ...(previous?.lastOpenedAt ? { lastOpenedAt: previous.lastOpenedAt } : {}) };
        await store.replaceTool({ ...record, tool, versions: record.versions.map((v) => ({ ...v, toolId: id })) }, scopeId);
        // Until it changes here, the tool reads out as the file it came from. Rewritten in this
        // module's own spelling, it would pass for work of ours, which outlives the file's deletion.
        if (!copy) {
          const key = keyOf(scopeId, id);
          written.set(key, { generation: generations.get(key) ?? 0, contents: item.contents });
        }
        kept.add(id);
        state.files[id] = { file: item.id, name: tool.name };
        stateChanged = true;
      }

      // A tool whose file the engine knew alive and has lost was deleted on disk. A tool made since
      // the last read, or one whose item the engine would not take, is not.
      const before = engineRecords(scopeId);
      for (const [id, file] of read?.fileOf ?? []) {
        if (kept.has(id) || !local.has(id)) continue;
        const known = before.get(file.toLowerCase());
        if (!known || known.tombstone) continue;
        await store.deleteTool(id, scopeId, { fromDisk: true });
        delete state.files[id];
        stateChanged = true;
      }
      if (stateChanged) await store.saveToolsDiskState(state, scopeId);
    },
  };

  return {
    descriptor,
    dispose: () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
