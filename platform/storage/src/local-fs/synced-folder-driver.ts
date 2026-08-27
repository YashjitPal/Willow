/**
 * Binds a registered synced folder to a real workspace directory and runs the
 * engine over it.
 *
 * Split from `folder-sync-engine.ts` on purpose: the engine is pure algorithm
 * with no filesystem or storage types, which is what makes it testable. This
 * module is the adapter that supplies it with a `FileSystemDirectoryHandle`,
 * localStorage-backed sync records, and a per-item lock.
 *
 * Sync records live in localStorage under a scope-suffixed key, mirroring how
 * chats already do it (`chatMetadataKeysForScope`) so behaviour and storage
 * shape stay consistent between the folders that predate the registry and the
 * ones that use it.
 */

import {
  type DiskEntry,
  type FolderSyncPorts,
  type ReconcileResult,
  isValidItemId,
  reconcileFolder,
} from './folder-sync-engine';
import type { SyncedFolderDescriptor, SyncedItem } from '../synced-folders';
import type { FolderSyncRecord } from './folder-sync-engine';

const readJSON = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch { return fallback; }
};

const validateIds = (value: unknown): string[] => Array.isArray(value) ? Array.from(new Set(value.filter(isValidItemId))) : [];
const validateTimestamps = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [id, timestamp] of Object.entries(value as Record<string, unknown>)) {
    if (isValidItemId(id) && typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp >= 0) result[id] = timestamp;
  }
  return result;
};
const validateRecords = (value: unknown): Record<string, FolderSyncRecord> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, FolderSyncRecord> = {};
  for (const [id, raw] of Object.entries(value as Record<string, any>)) {
    if (!isValidItemId(id) || !raw || typeof raw !== 'object') continue;
    result[id] = {
      revision: Number.isFinite(raw.revision) ? Math.max(0, raw.revision) : 0,
      diskRevision: Number.isFinite(raw.diskRevision) ? Math.max(0, raw.diskRevision) : 0,
      diskMtime: Number.isFinite(raw.diskMtime) ? Math.max(0, raw.diskMtime) : 0,
      dirty: raw.dirty === true, tombstone: raw.tombstone === true,
      updatedAt: Number.isFinite(raw.updatedAt) ? Math.max(0, raw.updatedAt) : 0,
    };
  }
  return result;
};

const writeTextFileRecursively = async (root: FileSystemDirectoryHandle, filePath: string, contents: string): Promise<void> => {
  const parts = filePath.replace(/\\/g, '/').replace(/^\//, '').split('/').filter((part) => part && part !== '.');
  if (!parts.length || parts.some((part) => part === '..')) throw new Error(`Invalid file path: ${filePath}`);
  let dir = root;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
  const handle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  const writable = await handle.createWritable();
  try { await writable.write(contents); await writable.close(); }
  catch (error) { try { await writable.abort(error); } catch {} throw error; }
};

/** localStorage keys for one folder in one scope. */
export const syncedFolderKeys = (folder: string, scopeId: string) => {
  const suffix = `${encodeURIComponent(folder)}:${encodeURIComponent(scopeId)}`;
  return {
    ids: `willow_synced_ids:${suffix}`,
    timestamps: `willow_synced_timestamps:${suffix}`,
    sync: `willow_synced_state:${suffix}`,
    hashes: `willow_synced_hashes:${suffix}`,
  };
};

const isValidHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]+$/.test(value);

const readHashMap = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const hashes: Record<string, string> = {};
  for (const [id, hash] of Object.entries(value as Record<string, unknown>)) {
    if (isValidHash(hash)) hashes[id] = hash;
  }
  return hashes;
};

const contentHash = (contents: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < contents.length; index += 1) {
    hash ^= contents.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

/**
 * Per-item lock shared by every synced folder.
 *
 * Two layers, matching `enqueueChatOperation`: an in-tab promise chain per id,
 * plus Web Locks so a second tab cannot interleave with this one. Keyed by
 * folder as well as id, so two folders never block each other.
 */
const inTabQueues = new Map<string, Promise<unknown>>();

export const lockItems = async <T,>(
  folder: string,
  scopeId: string,
  ids: string[],
  operation: () => Promise<T>,
): Promise<T | undefined> => {
  const keys = Array.from(new Set(ids.filter(Boolean))).sort().map((id) => `${folder}:${scopeId}:${id}`);
  const predecessors = keys.map((key) => inTabQueues.get(key)).filter(Boolean) as Promise<unknown>[];

  const withCrossTabLocks = async (index = 0): Promise<T> => {
    const locks = (globalThis.navigator as any)?.locks;
    if (!locks?.request || index >= keys.length) return operation();
    return locks.request(`willow-synced:${keys[index]}`, () => withCrossTabLocks(index + 1));
  };

  const run = Promise.allSettled(predecessors).then(() => withCrossTabLocks());
  const settled = run.then(() => undefined, () => undefined);
  for (const key of keys) inTabQueues.set(key, settled);
  try {
    return await run;
  } finally {
    for (const key of keys) {
      if (inTabQueues.get(key) === settled) inTabQueues.delete(key);
    }
  }
};

/**
 * Reconcile one registered folder against disk.
 *
 * `workspaceDir` is the workspace root; the folder is created on demand, so a
 * newly registered feature works on an existing workspace without a migration.
 * Returns the engine's result, or a not-ok result when the folder is paused or
 * unreachable — callers must treat not-ok as "change nothing".
 */
export const syncRegisteredFolder = async (
  workspaceDir: FileSystemDirectoryHandle,
  descriptor: SyncedFolderDescriptor,
  scopeId: string,
): Promise<ReconcileResult> => {
  const notOk: ReconcileResult = { ok: false, items: [], changed: false, deleted: [], conflicts: [] };
  const ctx = { scopeId };

  // Invariants 5/8/13: a paused folder behaves exactly like a failed scan.
  if (descriptor.isPaused?.(ctx)) return notOk;

  let dir: FileSystemDirectoryHandle;
  try {
    dir = workspaceDir;
    for (const segment of descriptor.folder.split('/')) {
      dir = await dir.getDirectoryHandle(segment, { create: true });
    }
  } catch {
    return notOk;
  }

  const keys = syncedFolderKeys(descriptor.folder, scopeId);
  const records = validateRecords(readJSON(keys.sync, {}));
  const ids = validateIds(readJSON(keys.ids, [] as string[]));
  const timestamps = validateTimestamps(readJSON(keys.timestamps, {}));
  const hashes = readHashMap(readJSON(keys.hashes, {}));

  // Seed the cache from whatever the feature currently holds, so its own state
  // is what the engine diffs against disk.
  let localItems: SyncedItem[];
  try {
    const readItems = await descriptor.readLocal(ctx);
    // Invalid ids must never reach getFileHandle(): ids are file-name stems,
    // so accepting path separators here would let feature data escape its
    // registered folder. Abort the whole pass instead of filtering malformed
    // items: filtering something that existed on the prior pass could make a
    // temporary serializer bug look exactly like an intentional deletion.
    if (!Array.isArray(readItems) || readItems.some(
      (item) => !isValidItemId(item?.id) || typeof item.contents !== 'string',
    )) return notOk;
    localItems = [...new Map(readItems.map((item) => [item.id, item] as const)).values()];
  } catch {
    // A store read failure is not an empty collection. Treating it as one
    // would turn a transient IndexedDB/state error into durable tombstones.
    return notOk;
  }
  const cache = new Map<string, string>(localItems.map((item) => [item.id, item.contents] as const));
  const localIds = new Set(localItems.map((item) => item.id));
  // A hydrated feature omitting an item is an intentional local deletion. Turn
  // that into the same durable tombstone the shared engine uses for disk-side
  // deletions, so the file is removed rather than resurrected on the next pass.
  for (const id of Object.keys(hashes)) {
    if (!localIds.has(id) && ids.includes(id) && records[id] && !records[id].tombstone) {
      records[id] = {
        ...records[id],
        revision: records[id].revision + 1,
        dirty: false,
        tombstone: true,
        updatedAt: Date.now(),
      };
    }
  }
  for (const item of localItems) {
    if (!ids.includes(item.id) && !records[item.id]?.tombstone) {
      ids.push(item.id);
      // A browser-only record has never been seen on disk. Mark it dirty so
      // the first connected-folder reconcile exports it instead of treating
      // its absence from a brand-new folder as an external deletion.
      if (!records[item.id]) {
        records[item.id] = {
          revision: 1,
          diskRevision: 0,
          diskMtime: 0,
          dirty: true,
          tombstone: false,
          updatedAt: Date.now(),
        };
      }
    } else if (records[item.id] && !records[item.id].tombstone) {
      const hash = contentHash(item.contents);
      if (hashes[item.id] && hashes[item.id] !== hash) {
        records[item.id] = {
          ...records[item.id],
          revision: records[item.id].revision + 1,
          dirty: true,
          updatedAt: Date.now(),
        };
      }
    }
    hashes[item.id] = contentHash(item.contents);
  }

  const fileName = (id: string) => `${id}${descriptor.extension}`;

  const ports: FolderSyncPorts = {
    records,
    ids,
    timestamps,

    list: async () => {
      const entries: DiskEntry[] = [];
      for await (const entry of (dir as any).values()) {
        if (entry.kind !== 'file' || !entry.name.endsWith(descriptor.extension)) continue;
        const id = entry.name.slice(0, -descriptor.extension.length);
        const file = await entry.getFile();
        entries.push({ id, mtime: file.lastModified, read: () => entry.getFile().then((f: File) => f.text()) });
      }
      return entries;
    },

    statNow: async (id) => {
      try {
        await dir.getFileHandle(fileName(id));
        return 'present';
      } catch (error: any) {
        // Only a genuine absence is evidence of a deletion.
        return error?.name === 'NotFoundError' ? 'absent' : 'unreadable';
      }
    },

    write: async (id, contents) => {
      await writeTextFileRecursively(dir, fileName(id), contents);
      const file = await (await dir.getFileHandle(fileName(id))).getFile();
      return { mtime: file.lastModified };
    },
    remove: async (id) => { await dir.removeEntry(fileName(id)); },

    readCache: async (id) => (cache.has(id) ? cache.get(id)! : null),
    writeCache: async (id, contents) => { cache.set(id, contents); },
    deleteCache: async (id) => { cache.delete(id); },

    lock: (lockIds, operation) => lockItems(descriptor.folder, scopeId, lockIds, operation),
    nextRevision: (id) => (records[id]?.revision || 0) + 1,
  };

  const result = await reconcileFolder(ports);
  if (!result.ok) return notOk;

  for (const item of result.items) hashes[item.id] = contentHash(item.contents);
  for (const id of result.deleted) delete hashes[id];
  // Invariant 7: only touch feature state when something actually changed.
  // Commit metadata only after the feature accepts the result. If applying
  // fails, retaining the previous metadata makes the next pass retry instead
  // of considering an update delivered when it was not.
  if (result.changed) {
    try {
      await descriptor.applyRemote(result.items, ctx);
    } catch {
      return notOk;
    }
  }

  persistFolderMetadata(keys, ids, timestamps, records, hashes);

  return result;
};

const persistFolderMetadata = (
  keys: ReturnType<typeof syncedFolderKeys>,
  ids: string[],
  timestamps: Record<string, number>,
  records: Record<string, FolderSyncRecord>,
  hashes: Record<string, string>,
): void => {
  try {
    localStorage.setItem(keys.ids, JSON.stringify(ids));
    localStorage.setItem(keys.timestamps, JSON.stringify(timestamps));
    localStorage.setItem(keys.sync, JSON.stringify(records));
    localStorage.setItem(keys.hashes, JSON.stringify(hashes));
  } catch {
    // Quota or private-mode failure must not break the sync pass.
  }
};
