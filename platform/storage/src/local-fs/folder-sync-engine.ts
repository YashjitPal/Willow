/**
 * The reconcile engine: one implementation of disk<->local sync, shared by every
 * synced folder.
 *
 * This is the algorithm that used to exist only inline inside
 * `reconcileChatsWithDisk`, lifted out so a second data type does not mean a
 * second hand-written reconciler. It is deliberately ignorant of chats, media,
 * React, and `FileSystemDirectoryHandle`: everything it touches arrives through
 * `FolderSyncPorts`, which is also what makes it unit-testable with an in-memory
 * fake (see apps/studio/test/folder-sync-engine.test.mjs).
 *
 * The correctness rules it owns, so callers never restate them:
 *
 *  - **Durable tombstones win over a present disk file.** A failed removal is
 *    retried on every pass and can never resurrect a deleted item.
 *  - **A delete decision is re-checked against live disk.** The directory
 *    listing is taken once at the start of a pass, but the delete decision is
 *    reached only after every per-item await — so absence in the listing is not
 *    proof. This is the bug that erased a chat seconds after it was renamed to
 *    its generated title.
 *  - **Only a genuine `NotFoundError` counts as a deletion.** A permission or
 *    transient error is never read as "the user deleted this".
 *  - **A dirty item whose body cannot be read is retried, never erased.**
 *    `dirty` means local work disk has never seen; an unreadable body is a read
 *    to retry.
 *  - **An externally changed file is preserved as a conflict copy** before the
 *    local dirty revision is rewritten, so neither side is silently lost.
 *  - **Nothing is deleted when the scan failed or the folder is paused**
 *    (ARCHITECTURE.md invariants 5, 8, 13).
 *
 * See ARCHITECTURE.md §13 for how to add a folder, and §11 for the invariants.
 */

import type { SyncedItem } from '../synced-folders';
import { type ChatSyncRecord as FolderSyncRecord, isValidChatId } from './chat-metadata';

export type { FolderSyncRecord };

/**
 * An id the engine will act on: valid as a stored id AND able to survive a round
 * trip through the filesystem, since the id *is* the file name stem.
 *
 * `isValidChatId` deliberately stays looser — it guards ids already persisted in
 * localStorage, and tightening it would invalidate existing data. The stricter
 * rule belongs here, at the point where an id becomes a path. Note this is the
 * same character class `saveLocalFSChat` strips when it sanitizes a title.
 */
export const isValidItemId = (value: unknown): value is string =>
  isValidChatId(value) && !/[\\/:*?"<>|]/.test(value);

/** What one file on disk looks like to the engine. */
export interface DiskEntry {
  id: string;
  mtime: number;
  read: () => Promise<string>;
}

/**
 * Everything the engine needs from the outside world. Implemented for real by
 * LocalFSContext against a directory handle, and by a fake in tests.
 */
export interface FolderSyncPorts {
  /** List candidate files. Reject the whole pass by throwing — see `ok` below. */
  list: () => Promise<DiskEntry[]>;
  /** Does this id exist on disk *right now*? Distinguishes absent from unreadable. */
  statNow: (id: string) => Promise<'present' | 'absent' | 'unreadable'>;
  write: (id: string, contents: string) => Promise<{ mtime: number }>;
  remove: (id: string) => Promise<void>;
  /** Local cache (IndexedDB in the app). `null` means "cannot read right now". */
  readCache: (id: string) => Promise<string | null>;
  writeCache: (id: string, contents: string) => Promise<void>;
  deleteCache: (id: string) => Promise<void>;
  /** Mutable sync records, keyed by item id. Owned by the caller so it persists. */
  records: Record<string, FolderSyncRecord>;
  /** Mutable id list, newest-first ordering applied by the caller. */
  ids: string[];
  /** Mutable id -> mtime map. */
  timestamps: Record<string, number>;
  /** Serialize access per id, in-tab and across tabs. */
  lock: <T>(ids: string[], operation: () => Promise<T>) => Promise<T | undefined>;
  /** Monotonic per-item revision counter. */
  nextRevision: (id: string) => number;
  /** Called once per changed item so the caller can notify its UI. */
  onItemChanged?: (id: string, change: 'updated' | 'deleted') => void;
}

export interface ReconcileResult {
  /** False when the pass was skipped or the scan failed — implies zero deletes. */
  ok: boolean;
  /** Items the caller should now hold locally. Empty when `ok` is false. */
  items: SyncedItem[];
  /** True when anything at all changed, so the caller can stay change-only. */
  changed: boolean;
  deleted: string[];
  conflicts: string[];
}

const EMPTY: ReconcileResult = { ok: false, items: [], changed: false, deleted: [], conflicts: [] };

/**
 * The location half of a record, as it stands for every folder but chats.
 *
 * The record type is shared with chats, and chats are the only items that can be
 * in more than one directory (the global `Chats/` or a notebook's). A flat synced
 * folder is a single path segment by construction — ARCHITECTURE.md §13 — so
 * there is nothing here to track, and these constants say so once instead of at
 * each of the three places a record is built.
 */
const FLAT_LOCATION = { notebookId: '', locationDirty: false } as const;

/** Deterministic name for the copy that preserves an externally-edited file. */
const makeConflictId = (id: string, taken: Set<string>): string => {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const base = `${id.slice(0, 180)} (Disk conflict ${stamp})`;
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate)) candidate = `${base} ${suffix++}`;
  taken.add(candidate);
  return candidate;
};

/**
 * Reconcile one folder against disk. Safe to call concurrently with saves: every
 * per-item step runs under `ports.lock`, and no deletion is taken on the strength
 * of a stale listing.
 */
export const reconcileFolder = async (ports: FolderSyncPorts): Promise<ReconcileResult> => {
  let diskEntries: DiskEntry[];
  try {
    diskEntries = await ports.list();
  } catch {
    // Invariant 5: a failed scan performs zero deletions.
    return EMPTY;
  }

  const disk = new Map<string, DiskEntry>();
  for (const entry of diskEntries) {
    if (isValidItemId(entry.id)) disk.set(entry.id, entry);
  }

  const deleted: string[] = [];
  const conflicts: string[] = [];
  let changed = false;
  const taken = new Set<string>([...ports.ids, ...disk.keys()]);

  // Durable tombstones beat a still-present file, and the removal is retried
  // every pass until it sticks.
  for (const [id, record] of Object.entries(ports.records)) {
    if (!record.tombstone) continue;
    if (disk.has(id)) {
      try {
        await ports.remove(id);
        disk.delete(id);
      } catch {}
    }
    try { await ports.deleteCache(id); } catch {}
    if (ports.ids.includes(id)) {
      ports.ids.splice(0, ports.ids.length, ...ports.ids.filter((x) => x !== id));
      changed = true;
    }
  }

  // Pass 1 — everything disk currently has.
  for (const [id, entry] of disk) {
    await ports.lock([id], async () => {
      let record = ports.records[id];
      if (record?.tombstone) return;

      let cached: string | null = null;
      try { cached = await ports.readCache(id); } catch {}
      const diskChanged = !record || !record.diskMtime || entry.mtime !== record.diskMtime;
      if (!record?.dirty && cached !== null && !diskChanged) {
        if (!ports.ids.includes(id)) { ports.ids.push(id); changed = true; }
        return;
      }

      let diskText: string;
      try {
        diskText = await entry.read();
      } catch {
        // Unreadable right now: leave every record untouched and retry later.
        return;
      }

      if (record?.dirty && cached !== null) {
        const contentDiffers = diskText !== cached;
        const externallyChanged = contentDiffers && (!record.diskMtime || entry.mtime !== record.diskMtime);
        if (externallyChanged) {
          // Preserve the external version before the local dirty revision
          // overwrites the file, so neither side is lost.
          const conflictId = makeConflictId(id, taken);
          await ports.writeCache(conflictId, diskText);
          const written = await ports.write(conflictId, diskText);
          const conflictRevision = ports.nextRevision(conflictId);
          ports.records[conflictId] = {
            revision: conflictRevision,
            diskRevision: conflictRevision,
            diskMtime: written.mtime,
            dirty: false,
            tombstone: false,
            updatedAt: Date.now(),
            ...FLAT_LOCATION,
          };
          ports.timestamps[conflictId] = entry.mtime;
          ports.ids.push(conflictId);
          conflicts.push(conflictId);
          changed = true;
        }
        await flushDirty(ports, id, cached);
        return;
      }

      // Clean disk revisions are authoritative.
      await ports.writeCache(id, diskText);
      const revision = Math.max(record?.revision || 0, record?.diskRevision || 0);
      ports.records[id] = {
        revision,
        diskRevision: revision,
        diskMtime: entry.mtime,
        dirty: false,
        tombstone: false,
        updatedAt: Date.now(),
        ...FLAT_LOCATION,
      };
      ports.timestamps[id] = entry.mtime;
      if (!ports.ids.includes(id)) ports.ids.push(id);
      ports.onItemChanged?.(id, 'updated');
      changed = true;
    });
  }

  // Pass 2 — ids we hold that the listing did not contain. This is the only
  // place items are destroyed, and the only place that has ever lost user data,
  // so each guard below is load-bearing.
  for (const id of [...ports.ids]) {
    if (disk.has(id)) continue;
    await ports.lock([id], async () => {
      const record = ports.records[id];
      if (record?.tombstone) return;

      // The listing was taken before every await above — seconds ago. An item
      // saved in that window is on disk and absent from the listing, which read
      // as an external delete and erased a conversation the user was in. Absence
      // has to be true NOW to count.
      const live = await ports.statNow(id);
      if (live === 'present') {
        if (!ports.ids.includes(id)) { ports.ids.push(id); changed = true; }
        return;
      }
      // Only a genuine absence is evidence. Unreadable is not.
      if (live !== 'absent') return;

      if (record?.dirty) {
        let body: string | null = null;
        try { body = await ports.readCache(id); } catch {}
        if (body === null) {
          // `dirty` means local work disk has never seen, so a body we cannot
          // read is a read to retry — not proof of an external delete. Falling
          // through to the tombstone here is what permanently erased chats.
          return;
        }
        await flushDirty(ports, id, body);
        return;
      }

      // Clean, absent from disk now: a real external deletion.
      const revision = ports.nextRevision(id);
      ports.records[id] = {
        revision,
        diskRevision: record?.diskRevision || 0,
        diskMtime: record?.diskMtime || 0,
        dirty: false,
        tombstone: true,
        updatedAt: Date.now(),
        ...FLAT_LOCATION,
      };
      ports.ids.splice(0, ports.ids.length, ...ports.ids.filter((x) => x !== id));
      delete ports.timestamps[id];
      try { await ports.deleteCache(id); } catch {}
      deleted.push(id);
      ports.onItemChanged?.(id, 'deleted');
      changed = true;
    });
  }

  const items: SyncedItem[] = [];
  for (const id of ports.ids) {
    if (ports.records[id]?.tombstone) continue;
    let contents: string | null = null;
    try { contents = await ports.readCache(id); } catch {}
    if (contents !== null) items.push({ id, contents });
  }

  return { ok: true, items, changed, deleted, conflicts };
};

/**
 * Write a dirty local revision back to disk, clearing `dirty` only on success.
 * A failure leaves it dirty so a later pass retries — never data loss.
 */
const flushDirty = async (ports: FolderSyncPorts, id: string, contents: string): Promise<void> => {
  try {
    const written = await ports.write(id, contents);
    const latest = ports.records[id];
    if (latest?.dirty) {
      ports.records[id] = {
        ...latest,
        diskRevision: latest.revision,
        diskMtime: written.mtime,
        dirty: false,
        updatedAt: Date.now(),
      };
    }
    if (!ports.ids.includes(id)) ports.ids.push(id);
  } catch {
    // Keep dirty; a later watcher/focus tick retries the flush.
  }
};

