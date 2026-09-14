/**
 * Saved Info on disk.
 *
 * The instructions the user types in Settings → Personal Intelligence → Saved
 * Info are their own words about themselves, so they belong in the folder they
 * chose for their own data, next to `Chats/`, `Code/` and `Media/` — not shut
 * inside browser storage where a cleared site datum loses them and a reinstall
 * cannot find them.
 *
 * `Personal/saved-info.json` rather than a bare file at the folder root: the
 * long-term memory work lands in the same folder later, and a second top-level
 * folder for one file each would read as clutter in a directory the user opens
 * in their file manager.
 *
 *   <chosen folder>/Personal/saved-info.json
 *
 * One rule this file exists to hold, learned the hard way elsewhere in this
 * layer: the read path never passes `{ create: true }`. Fabricating an empty
 * folder on a read made every cached chat look externally deleted.
 *
 * Every function swallows its errors and reports failure through its return
 * value: losing the disk copy must not break the settings page, which still has
 * the localStorage mirror to fall back on.
 */

import type { DiskDeps } from './disk-deps';

/** Only the folder half of DiskDeps; Saved Info is not project-addressed. */
export type SavedInfoDiskDeps = Pick<DiskDeps, 'getActiveHandle'>;

export const PERSONAL_DIR = 'Personal';
export const SAVED_INFO_FILE = 'saved-info.json';

/**
 * What lands in the file. Deliberately a superset of the store's own shape:
 * `version` so a later format can be recognised rather than guessed at, and
 * `updatedAt` because this file is meant to be legible to the person who owns
 * it, opened in a text editor with no app running.
 */
export type SavedInfoDiskPayload = {
  version: number;
  updatedAt: string;
  enabled: boolean;
  instructions: { id: string; text: string; createdAt?: string }[];
};

export const SAVED_INFO_DISK_VERSION = 1;

/**
 * Read the saved-info file, or `null` when there is no folder, no permission,
 * or nothing written yet. `null` means "disk has nothing to say" and the caller
 * keeps whatever it already had — it is never an instruction to clear.
 */
export const readSavedInfoFromDisk = async (
  { getActiveHandle }: SavedInfoDiskDeps,
): Promise<SavedInfoDiskPayload | null> => {
  const rootHandle = await getActiveHandle();
  if (!rootHandle) return null;

  try {
    // No `{ create: true }` anywhere on this path. A missing folder is the
    // normal state before the user's first instruction.
    const personalDir = await rootHandle.getDirectoryHandle(PERSONAL_DIR);
    const fileHandle = await personalDir.getFileHandle(SAVED_INFO_FILE);
    const text = await (await fileHandle.getFile()).text();
    if (!text.trim()) return null;

    const parsed = JSON.parse(text) as Partial<SavedInfoDiskPayload>;
    if (!parsed || typeof parsed !== 'object') return null;

    return {
      version: typeof parsed.version === 'number' ? parsed.version : SAVED_INFO_DISK_VERSION,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      // An older file with no toggle is an enabled one: the switch was added
      // after the entries were, and defaulting it off would silently stop
      // instructions the user had already saved from reaching a turn.
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
      instructions: Array.isArray(parsed.instructions) ? parsed.instructions : [],
    };
  } catch {
    return null;
  }
};

/**
 * Write the saved-info file, creating `Personal/` on the way if it is not there.
 *
 * Call this only in response to a user edit — see rule 1 in the file comment.
 */
export const writeSavedInfoToDisk = async (
  { getActiveHandle }: SavedInfoDiskDeps,
  payload: Omit<SavedInfoDiskPayload, 'version' | 'updatedAt'> & { updatedAt?: string },
): Promise<boolean> => {
  const rootHandle = await getActiveHandle();
  if (!rootHandle) return false;

  try {
    const personalDir = await rootHandle.getDirectoryHandle(PERSONAL_DIR, { create: true });
    const fileHandle = await personalDir.getFileHandle(SAVED_INFO_FILE, { create: true });

    const body: SavedInfoDiskPayload = {
      version: SAVED_INFO_DISK_VERSION,
      updatedAt: payload.updatedAt ?? new Date().toISOString(),
      enabled: payload.enabled,
      instructions: payload.instructions,
    };

    const writable = await fileHandle.createWritable();
    // Indented: this file is one the user is expected to be able to read.
    await writable.write(`${JSON.stringify(body, null, 2)}\n`);
    await writable.close();
    return true;
  } catch {
    return false;
  }
};

/**
 * Delete the saved-info file. Used when the user clears every instruction, so
 * the folder does not keep a stale copy of what they just removed.
 *
 * `Personal/` itself is left in place: an empty folder is harmless, and removing
 * a directory the user may have put their own files in is not this module's call.
 */
export const deleteSavedInfoFromDisk = async (
  { getActiveHandle }: SavedInfoDiskDeps,
): Promise<boolean> => {
  const rootHandle = await getActiveHandle();
  if (!rootHandle) return false;

  try {
    const personalDir = await rootHandle.getDirectoryHandle(PERSONAL_DIR);
    await personalDir.removeEntry(SAVED_INFO_FILE);
    return true;
  } catch {
    return false;
  }
};
