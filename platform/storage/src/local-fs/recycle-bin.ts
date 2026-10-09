/**
 * The Recycle Bin at the root of the user's folder. Whatever the user deletes in Willow — a chat, a
 * project, a Gem, a dot, a Spark task, a media file, a notebook — is moved here instead of erased:
 *
 *   <folder>/Recycle Bin/<YYYY-MM-DD>/<where it was>/<its name>
 *
 * so the bin's folders say where each thing came from, and moving one back to where it was brings it
 * back. Willow never reads the bin and never empties it; the user empties it when they like.
 *
 * Something moved back is told apart from a copy of Willow writing a deleted item again by its time:
 * a file keeps its modified time through the move here and back, so it is no newer than its removal,
 * while anything Willow writes is newer. The reconcilers keep `removedAt` on a tombstone for this
 * (folder-sync-engine.ts for the registered folders, LocalFSContext for chats). Renames and moves
 * inside the folder, and the housekeeping that replaces a file (a project's cover), are not
 * deletions and do not come here.
 */

export const RECYCLE_BIN_FOLDER = 'Recycle Bin';

/** Where something removed from a folder goes: the folder's root, and the folder's path in it. */
export interface RecycleBinPlace {
  root: FileSystemDirectoryHandle;
  path: string[];
}

const README = 'README.txt';
const README_TEXT = `Willow moves anything you delete here instead of erasing it, one folder for each day.

The folders inside each day are named after where each thing was in your Willow folder. To bring one back, move it back to that folder as it is, without renaming it: Willow picks it up within a minute. A chat's files are in the folder of the same name beside it; a project comes back as its whole folder.

Willow never empties this folder. Delete what is in it whenever you like.
`;

const pad = (value: number): string => String(value).padStart(2, '0');

const today = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const named = (error: unknown, name: string): boolean => (error as { name?: string } | null)?.name === name;

/** The file or folder called `name` in `dir`; NotFoundError when there is none. */
const entryIn = async (dir: FileSystemDirectoryHandle, name: string): Promise<FileSystemHandle> => {
  try {
    return await dir.getFileHandle(name);
  } catch (error) {
    if (!named(error, 'TypeMismatchError')) throw error;
    return dir.getDirectoryHandle(name);
  }
};

const taken = async (dir: FileSystemDirectoryHandle, name: string): Promise<boolean> => {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch (error) {
    return named(error, 'TypeMismatchError');
  }
};

/** `name`, or `name (2)`, `name (3)`… — the first one `dir` does not hold yet. */
const freeName = async (dir: FileSystemDirectoryHandle, name: string): Promise<string> => {
  if (!(await taken(dir, name))) return name;
  const dot = name.lastIndexOf('.');
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let copy = 2; ; copy += 1) {
    const candidate = `${stem} (${copy})${extension}`;
    if (!(await taken(dir, candidate))) return candidate;
  }
};

const copyInto = async (entry: FileSystemHandle, to: FileSystemDirectoryHandle, name: string): Promise<void> => {
  if (entry.kind === 'file') {
    const file = await (entry as FileSystemFileHandle).getFile();
    const writable = await (await to.getFileHandle(name, { create: true })).createWritable();
    try {
      await writable.write(file);
      await writable.close();
    } catch (error) {
      try { await writable.abort(); } catch {}
      throw error;
    }
    return;
  }
  const dir = await to.getDirectoryHandle(name, { create: true });
  for await (const child of (entry as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values()) {
    await copyInto(child, dir, child.name);
  }
};

const ensureReadme = async (bin: FileSystemDirectoryHandle): Promise<void> => {
  if (await taken(bin, README)) return;
  const writable = await (await bin.getFileHandle(README, { create: true })).createWritable();
  await writable.write(README_TEXT);
  await writable.close();
};

/**
 * Moves the file or folder `name` out of `parent` into the Recycle Bin. A browser that moves handles
 * does it in one step; otherwise it is copied, and the original removed only once the copy is whole.
 * It throws where it could not, leaving the original where it was: NotFoundError when there is
 * nothing to move.
 */
export async function moveToRecycleBin(place: RecycleBinPlace, parent: FileSystemDirectoryHandle, name: string): Promise<void> {
  const entry = await entryIn(parent, name);
  const bin = await place.root.getDirectoryHandle(RECYCLE_BIN_FOLDER, { create: true });
  try { await ensureReadme(bin); } catch {}
  let dir = await bin.getDirectoryHandle(today(), { create: true });
  for (const segment of place.path) dir = await dir.getDirectoryHandle(segment, { create: true });
  const target = await freeName(dir, name);
  const move = (entry as unknown as { move?: (to: FileSystemDirectoryHandle, name: string) => Promise<void> }).move;
  if (typeof move === 'function') {
    try {
      await move.call(entry, dir, target);
      return;
    } catch {
      // Not a move this browser makes for this folder: copied instead.
    }
  }
  await copyInto(entry, dir, target);
  await parent.removeEntry(name, { recursive: entry.kind === 'directory' });
}
