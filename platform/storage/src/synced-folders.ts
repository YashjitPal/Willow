/**
 * Top-level synced folder contributors.
 *
 * A workspace on disk holds one folder per kind of thing the app persists —
 * `Chats/`, `Media/`, `Code/`, and whatever a future feature needs. Keeping the
 * sync engine ignorant of which kinds exist is what lets a feature add one
 * without touching `platform/storage`: the feature *registers* a descriptor here
 * and the engine drives it.
 *
 * This is the top-level sibling of `./project-contributors.ts`. That registry
 * covers sub-folders INSIDE one saved project (`Code/<project>/Designs/`); this
 * one covers folders directly under the workspace root.
 *
 * Registration is a module side effect, so a descriptor only exists when the app
 * actually loads that feature, and `apps/studio/src/app/register-features.ts` is
 * the single place that pulls them in.
 *
 * What the engine gives you for free, and what you must NOT reimplement:
 * per-item revisions, durable tombstones, dirty tracking, in-tab + cross-tab
 * locking, conflict copies, and the delete-safety rules. A descriptor only says
 * what an item *is*; see `./local-fs/folder-sync-engine.ts` and the extension
 * guide in `ARCHITECTURE.md` §13.
 */

/** One item's identity and bytes, as it exists on disk. */
export interface SyncedItem {
  /**
   * Stable id, also the file name stem. Must survive a round trip through the
   * filesystem, so the engine rejects ids containing `\/:*?"<>|`.
   */
  id: string;
  /** File contents. Text only — heavy binary belongs on disk via its own path. */
  contents: string;
}

export interface SyncedFolderContext {
  /** Scope the read/write is happening under, e.g. `uid::rootId::workspace`. */
  scopeId: string;
}

export interface SyncedFolderDescriptor {
  /**
   * Folder name directly under the workspace root, e.g. `Gems`. One descriptor
   * owns one folder; two descriptors claiming the same folder is a programming
   * error and the registry throws on it.
   */
  folder: string;
  /**
   * File extension including the dot, e.g. `.json`. Files not matching it are
   * ignored, so unrelated user files in the folder are never touched.
   */
  extension: string;
  /**
   * Read every item this feature currently holds locally. The engine diffs this
   * against disk. Must not throw; return `[]` when there is nothing.
   */
  readLocal: (ctx: SyncedFolderContext) => Promise<SyncedItem[]>;
  /**
   * Apply the reconciled result. Called only when something actually changed,
   * so this may set state directly — see invariant 7 (change-only polling).
   */
  applyRemote: (items: SyncedItem[], ctx: SyncedFolderContext) => Promise<void>;
  /**
   * Optional. Whether syncing this folder should be skipped right now — e.g.
   * mid-generation or mid-rename. Returning `true` performs zero deletions,
   * exactly like a failed scan (invariants 5, 8 and 13).
   */
  isPaused?: (ctx: SyncedFolderContext) => boolean;
}

const descriptors = new Map<string, SyncedFolderDescriptor>();

/**
 * Register (or replace) a synced folder. `id` keeps registration idempotent
 * under hot-module reload — re-importing a feature must not double-register.
 */
export function registerSyncedFolder(id: string, descriptor: SyncedFolderDescriptor): void {
  const folder = descriptor.folder.trim();
  if (!folder || folder.includes('/') || folder.includes('\\')) {
    throw new Error(`registerSyncedFolder("${id}"): folder must be a single path segment, got "${descriptor.folder}"`);
  }
  if (!descriptor.extension.startsWith('.')) {
    throw new Error(`registerSyncedFolder("${id}"): extension must start with a dot, got "${descriptor.extension}"`);
  }
  // Two features writing one folder would race each other's reconciles and
  // delete each other's files. Fail loudly at registration instead.
  for (const [existingId, existing] of descriptors) {
    if (existingId !== id && existing.folder.toLowerCase() === folder.toLowerCase()) {
      throw new Error(
        `registerSyncedFolder("${id}"): folder "${folder}" is already owned by "${existingId}"`,
      );
    }
  }
  descriptors.set(id, { ...descriptor, folder });
}

export function unregisterSyncedFolder(id: string): void {
  descriptors.delete(id);
}

export function getSyncedFolders(): Array<SyncedFolderDescriptor & { id: string }> {
  return [...descriptors].map(([id, descriptor]) => ({ id, ...descriptor }));
}

/** Test seam. Not for app code. */
export function __clearSyncedFoldersForTest(): void {
  descriptors.clear();
}
