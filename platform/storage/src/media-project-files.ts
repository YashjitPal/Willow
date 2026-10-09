/**
 * Willow's own small files in a Media project's folder, beside its media: the details file
 * (`./media-details.ts`), a file per character in `Images/Characters/`, and the agent's chats in
 * `Agent sessions/`. LocalFSContext reaches them through these and puts each write in the project's
 * queue, as it does its media. Like ./local-fs/media-disk, failures come back as return values:
 * these are background syncs, made again on the next change.
 */

import { ensureProjectManifest } from './local-fs/project-manifest';
import { getProjectAreaFolder } from './local-fs/project-areas';
import { moveToRecycleBin } from './local-fs/recycle-bin';
import type { DiskDeps } from './local-fs/disk-deps';
import { MEDIA_DETAILS_FILE, mediaDetailsText, mergeMediaDetails, parseMediaDetails, type MediaDetailsFile } from './media-details';

/** Larger than any file of these; anything bigger in their folders is not one. */
const MAX_FILE_BYTES = 8_000_000;
const EXT = '.json';

export interface MediaFolderFile {
  fsName: string;
  text: string;
}

const segments = (path: string): string[] => path.split('/').filter(Boolean);

async function projectFolder({ getActiveHandle, resolveCurrentProjectName }: DiskDeps, projectName: string, create: boolean) {
  const root = await getActiveHandle();
  if (!root || !projectName) return null;
  // Redirect through any in-flight project rename, as every media write does.
  const name = resolveCurrentProjectName(projectName);
  const mediaDir = await root.getDirectoryHandle(getProjectAreaFolder('media'), { create });
  const dir = await mediaDir.getDirectoryHandle(name, { create });
  if (create) await ensureProjectManifest(dir, name);
  return { root, dir, name };
}

async function dirAt(dir: FileSystemDirectoryHandle, path: string, create: boolean): Promise<FileSystemDirectoryHandle> {
  let at = dir;
  for (const segment of segments(path)) at = await at.getDirectoryHandle(segment, { create });
  return at;
}

/** Whether something is at `path`; an error that is not "not there" counts as there, so nothing is dropped on it. */
async function present(dir: FileSystemDirectoryHandle, path: string, kind: 'file' | 'directory'): Promise<boolean> {
  const parts = segments(path);
  const name = parts.pop();
  if (!name) return false;
  try {
    const parent = await dirAt(dir, parts.join('/'), false);
    if (kind === 'file') await parent.getFileHandle(name);
    else await parent.getDirectoryHandle(name);
    return true;
  } catch (error: any) {
    return error?.name !== 'NotFoundError' && error?.name !== 'TypeMismatchError';
  }
}

async function readText(dir: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  const file = await (await dir.getFileHandle(name)).getFile();
  return file.size <= MAX_FILE_BYTES ? file.text() : null;
}

/** The project folder's details file, read back; null when there is none or it can't be read. */
export async function readMediaDetailsFile(projectDir: FileSystemDirectoryHandle): Promise<MediaDetailsFile | null> {
  try {
    const text = await readText(projectDir, MEDIA_DETAILS_FILE);
    return text === null ? null : parseMediaDetails(text);
  } catch {
    return null;
  }
}

/**
 * Writes this browser's details over the project's file, keeping each entry of the folder's copy whose
 * file is still there (`mergeMediaDetails`). Nothing is written when nothing would change, into a
 * project with no folder (it has no files to describe), or over a file that does not read as one — a
 * newer Willow's, or one being edited by hand.
 */
export async function writeMediaDetailsFile(deps: DiskDeps, projectName: string, details: MediaDetailsFile): Promise<boolean> {
  let at: Awaited<ReturnType<typeof projectFolder>>;
  try {
    at = await projectFolder(deps, projectName, false);
  } catch (error: any) {
    return error?.name === 'NotFoundError';
  }
  if (!at) return false;
  const { dir } = at;
  try {
    let before: string | null = null;
    try {
      before = await readText(dir, MEDIA_DETAILS_FILE);
      if (before === null) return false;
    } catch (error: any) {
      if (error?.name !== 'NotFoundError') return false;
    }
    const previous = before === null ? null : parseMediaDetails(before);
    if (before !== null && !previous) return false;
    const merged = await mergeMediaDetails(previous, details, {
      file: (place) => present(dir, place, 'file'),
      folder: (path) => present(dir, path, 'directory'),
    });
    if (before === null && !Object.keys(merged.items).length && !Object.keys(merged.collections).length) return true;
    const text = mediaDetailsText(merged);
    if (text === before) return true;
    const writable = await (await dir.getFileHandle(MEDIA_DETAILS_FILE, { create: true })).createWritable();
    await writable.write(text);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

/** The `.json` files in a folder of the project ("Images/Characters"); [] when there are none, null when it can't be read. */
export async function listMediaFolderFiles(deps: DiskDeps, projectName: string, folder: string): Promise<MediaFolderFile[] | null> {
  let dir: FileSystemDirectoryHandle;
  try {
    const at = await projectFolder(deps, projectName, false);
    if (!at) return null;
    dir = await dirAt(at.dir, folder, false);
  } catch (error: any) {
    return error?.name === 'NotFoundError' ? [] : null;
  }
  const out: MediaFolderFile[] = [];
  try {
    for await (const entry of (dir as any).values()) {
      const name = entry.name as string;
      if (entry.kind !== 'file' || name.startsWith('.') || !name.toLowerCase().endsWith(EXT)) continue;
      try {
        const file: File = await entry.getFile();
        if (file.size <= MAX_FILE_BYTES) out.push({ fsName: name, text: await file.text() });
      } catch {}
    }
  } catch {
    return null;
  }
  return out;
}

/** Writes one of those files, making its folder (and the project's) on the way. */
export async function writeMediaFolderFile(deps: DiskDeps, projectName: string, folder: string, fsName: string, text: string): Promise<boolean> {
  if (!fsName || fsName.includes('/')) return false;
  try {
    const at = await projectFolder(deps, projectName, true);
    if (!at) return false;
    const writable = await (await (await dirAt(at.dir, folder, true)).getFileHandle(fsName, { create: true })).createWritable();
    await writable.write(text);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

/** Moves one of those files to the Recycle Bin; true once it is gone, or was never there. */
export async function removeMediaFolderFile(deps: DiskDeps, projectName: string, folder: string, fsName: string): Promise<boolean> {
  if (!fsName || fsName.includes('/')) return true;
  try {
    const at = await projectFolder(deps, projectName, false);
    if (!at) return false;
    const dir = await dirAt(at.dir, folder, false);
    await moveToRecycleBin({ root: at.root, path: [getProjectAreaFolder('media'), at.name, ...segments(folder)] }, dir, fsName);
    return true;
  } catch (error: any) {
    return error?.name === 'NotFoundError';
  }
}
