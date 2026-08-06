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
  type ChatSyncRecord as FolderSyncRecord,
  readJSON,
  validateChatList,
  validateSyncRecords,
  validateTimestampMap,
} from './chat-metadata';
import { type DiskEntry, type FolderSyncPorts, type ReconcileResult, reconcileFolder } from './folder-sync-engine';
import type { SyncedFolderDescriptor, SyncedItem } from '../synced-folders';
import { writeFileRecursively } from '../adapters/local-disk';

/** localStorage keys for one folder in one scope. */
export const syncedFolderKeys = (folder: string, scopeId: string) => {
  const suffix = `${encodeURIComponent(folder)}:${encodeURIComponent(scopeId)}`;
  return {
    ids: `willow_synced_ids:${suffix}`,
    timestamps: `willow_synced_timestamps:${suffix}`,
    sync: `willow_synced_state:${suffix}`,
  };
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
    const locks = (navigator as any).locks;
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
    dir = await workspaceDir.getDirectoryHandle(descriptor.folder, { create: true });
  } catch {
    return notOk;
  }

  const keys = syncedFolderKeys(descriptor.folder, scopeId);
  const records = validateSyncRecords(readJSON(keys.sync, {}));
  const ids = validateChatList(readJSON(keys.ids, [] as string[]));
  const timestamps = validateTimestampMap(readJSON(keys.timestamps, {}));

  // Seed the cache from whatever the feature currently holds, so its own state
  // is what the engine diffs against disk.
  const localItems = await descriptor.readLocal(ctx).catch((): SyncedItem[] => []);
  const cache = new Map<string, string>(localItems.map((item) => [item.id, item.contents] as const));
  for (const item of localItems) {
    if (!ids.includes(item.id) && !records[item.id]?.tombstone) ids.push(item.id);
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
      await writeFileRecursively(dir, fileName(id), contents);
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

  persistFolderMetadata(keys, ids, timestamps, records);

  // Invariant 7: only touch feature state when something actually changed.
  if (result.changed) await descriptor.applyRemote(result.items, ctx).catch(() => {});

  return result;
};

const persistFolderMetadata = (
  keys: ReturnType<typeof syncedFolderKeys>,
  ids: string[],
  timestamps: Record<string, number>,
  records: Record<string, FolderSyncRecord>,
): void => {
  try {
    localStorage.setItem(keys.ids, JSON.stringify(ids));
    localStorage.setItem(keys.timestamps, JSON.stringify(timestamps));
    localStorage.setItem(keys.sync, JSON.stringify(records));
  } catch {
    // Quota or private-mode failure must not break the sync pass.
  }
};
