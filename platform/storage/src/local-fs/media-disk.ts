/**
 * Writing, deleting and renaming media files on the local disk.
 *
 * These are the name-addressed disk paths for a project's Media/ folder. They
 * were lifted out of LocalFSProvider because each one closes over nothing but
 * the three helpers it now receives as `deps`; the provider still wraps each in
 * a useCallback with its original dependency array, so context value identity is
 * unchanged.
 *
 * Every function here swallows its errors and reports failure through its return
 * value. A media write is a background sync, not a user action to fail loudly:
 * the caller keeps its in-memory state and retries on the next poll.
 */

import { ensureProjectManifest } from './project-manifest';
import { getProjectAreaFolder, registerProjectArea } from './project-areas';
import { moveToRecycleBin } from './recycle-bin';
import type { DiskDeps } from './disk-deps';

registerProjectArea({ id: 'media', folder: 'Media', kind: 'media', priority: 20 });

const kindFolder = (kind: 'image' | 'video' | 'audio'): string => (kind === 'image' ? 'Images' : kind === 'video' ? 'Videos' : 'Audio');

/**
 * The folder at `path` under `dir`: "A" or, for a collection inside another, "A/B" (collection
 * folder names never hold a "/"). Created on the way with `create`; otherwise a missing one throws.
 */
export async function dirAtPath(dir: FileSystemDirectoryHandle, path: string, create = false): Promise<FileSystemDirectoryHandle> {
  let at = dir;
  for (const segment of path.split('/').filter(Boolean)) at = await at.getDirectoryHandle(segment, { create });
  return at;
}

/**
 * The folder a media file lives in: its kind folder (Images/, Videos/, Audio/), or — for an item
 * in a collection — the collection's folder (its path, for one nested in another).
 */
const mediaDirFor = (projectDir: FileSystemDirectoryHandle, kind: 'image' | 'video' | 'audio', folder?: string, create = false): Promise<FileSystemDirectoryHandle> =>
  (folder ? dirAtPath(projectDir, folder, create) : projectDir.getDirectoryHandle(kindFolder(kind), { create }));

/** `fileName`, or "name (1).ext", "name (2).ext"… — the first that is free in `dir`. */
async function freeName(dir: FileSystemDirectoryHandle, fileName: string): Promise<string> {
  const lastDot = fileName.lastIndexOf('.');
  const baseName = lastDot !== -1 ? fileName.slice(0, lastDot) : fileName;
  const ext = lastDot !== -1 ? fileName.slice(lastDot) : '';
  let finalFileName = fileName;
  let counter = 1;
  for (;;) {
    try {
      await dir.getFileHandle(finalFileName, { create: false });
      finalFileName = `${baseName} (${counter})${ext}`;
      counter += 1;
    } catch {
      return finalFileName;
    }
  }
}

/**
 * Save media creations locally
 */
export const saveMediaFileToDisk = async (
  { getActiveHandle, resolveCurrentProjectName }: DiskDeps,
  projectName: string,
  kind: 'image' | 'video' | 'audio',
  fileName: string,
  blob: Blob,
  /** A collection's folder, for an item that is in one; otherwise its kind folder. */
  folder?: string,
): Promise<string | null> => {
  const rootHandle = await getActiveHandle();
  if (!rootHandle) return null;

  try {
    // Redirect through any in-flight rename — generation/backfill saves hold
    // the name across multi-second fetches; a stale name here resurrected
    // Media/<oldName>/ as a phantom project (or wrote into the folder
    // mid-move, where the copy-then-delete rename then destroyed the file).
    const targetName = resolveCurrentProjectName(projectName);
    const mediaDir = await rootHandle.getDirectoryHandle(getProjectAreaFolder('media'), { create: true });
    const projectDir = await mediaDir.getDirectoryHandle(targetName, { create: true });

    // Persist the stable project id alongside the media so re-discovery keeps it.
    await ensureProjectManifest(projectDir, targetName);

    // Pre-create Scenes and Music directories
    await projectDir.getDirectoryHandle('Scenes', { create: true });
    await projectDir.getDirectoryHandle('Music', { create: true });
    
    // Write file to Images or Videos or Audio subfolder, or to the item's collection folder.
    const subDir = await mediaDirFor(projectDir, kind, folder, true);
    
    // If image kind, also pre-create "Characters" subfolder
    if (kind === 'image' && !folder) {
      await subDir.getDirectoryHandle('Characters', { create: true });
    }

    // Dynamic file numbering collision check
    const lastDot = fileName.lastIndexOf('.');
    const baseName = lastDot !== -1 ? fileName.slice(0, lastDot) : fileName;
    const ext = lastDot !== -1 ? fileName.slice(lastDot) : '';

    let finalFileName = fileName;
    let counter = 1;
    let fileExists = true;

    while (fileExists) {
      try {
        // Check if file already exists in destination directory
        await subDir.getFileHandle(finalFileName, { create: false });
        // If this call succeeds, the file exists. Increment counter and try again.
        finalFileName = `${baseName} (${counter})${ext}`;
        counter++;
      } catch (e) {
        // If it throws, the file name is available!
        fileExists = false;
      }
    }

    const fileHandle = await subDir.getFileHandle(finalFileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    return finalFileName;
  } catch (err) {
    return null;
  }
};

/**
 * Delete a single media file from a project's Images/ or Videos/ folder on
 * disk. Used by in-app media-item deletion so the file is actually removed
 * (and the real-time poller won't re-ingest it). No-op if no folder/permission.
 */
export const deleteMediaFileFromDisk = async (
  { getActiveHandle, resolveCurrentProjectName }: DiskDeps,
  projectName: string,
  kind: 'image' | 'video' | 'audio',
  fsName: string,
  folder?: string,
): Promise<boolean> => {
  if (!projectName || !fsName) return false;
  const rootHandle = await getActiveHandle();
  if (!rootHandle) return false;
  try {
    // Deletion is a targeted operation — never create folders on the way.
    // Redirect through any in-flight rename so deletes chase the moved folder.
    const targetName = resolveCurrentProjectName(projectName);
    const mediaDir = await rootHandle.getDirectoryHandle(getProjectAreaFolder('media'));
    const projectDir = await mediaDir.getDirectoryHandle(targetName);
    // NOTE: audio artifacts live in Audio/ — this mapped audio to Videos/,
    // so deleting a song left its file behind (and once Audio/ became part of
    // the reconcile scan, the leftover file would resurrect the tile).
    const subDir = await mediaDirFor(projectDir, kind, folder);
    const path = [getProjectAreaFolder('media'), targetName, ...(folder ? folder.split('/') : [kindFolder(kind)])];
    await moveToRecycleBin({ root: rootHandle, path }, subDir, fsName);
    return true;
  } catch (err) {
    return false;
  }
};

/**
 * Rename a single media file on disk (Images/, Videos/ or Audio/) so a tile
 * rename in the gallery keeps the on-disk filename in lock-step with the
 * item's display name. Preserves the old file's extension VERBATIM (never
 * rederived from kind — external .jpg/.mp3 files must keep their real
 * extension), sanitizes the new base name, and dedupes against existing
 * files with the same "(1)" numbering as saveLocalFSMedia. Prefers the
 * native FileSystemHandle.move() (atomic), falling back to copy-then-delete
 * (the original is only removed AFTER a complete copy). Returns the FINAL
 * new fsName, oldFsName when nothing needed to change, or null when the
 * folder/permission/file is unavailable (caller keeps the metadata-only
 * rename in that case).
 */
export const renameMediaFileOnDisk = async (
  { getActiveHandle, resolveCurrentProjectName }: DiskDeps,
  projectName: string,
  kind: 'image' | 'video' | 'audio',
  oldFsName: string,
  newBaseName: string,
  folder?: string,
): Promise<string | null> => {
  if (!projectName || !oldFsName || !newBaseName?.trim()) return null;
  const rootHandle = await getActiveHandle();
  if (!rootHandle) return null;
  try {
    // Rename is a targeted operation — never create folders on the way.
    // Redirect through any in-flight project rename.
    const targetName = resolveCurrentProjectName(projectName);
    const mediaDir = await rootHandle.getDirectoryHandle(getProjectAreaFolder('media'));
    const projectDir = await mediaDir.getDirectoryHandle(targetName);
    const subDir = await mediaDirFor(projectDir, kind, folder);

    const lastDot = oldFsName.lastIndexOf('.');
    const ext = lastDot !== -1 ? oldFsName.slice(lastDot) : '';
    const cleanBase = newBaseName.replace(/[\/:*?"<>|]/g, '').trim() || 'media';

    // Dynamic file numbering collision check (same pattern as saveLocalFSMedia).
    let finalFileName = `${cleanBase}${ext}`;
    if (finalFileName === oldFsName) return oldFsName; // already in lock-step
    // CASE-ONLY rename ("pic.png" → "Pic.png"): on case-insensitive
    // filesystems (Windows/macOS) the collision probe would find the file
    // ITSELF and suffix it, and the copy-then-delete fallback would write to
    // and then DELETE the same entry. Skip the probe and only allow the
    // native atomic move for this case.
    const caseOnly = finalFileName.toLowerCase() === oldFsName.toLowerCase();
    if (!caseOnly) {
      let counter = 1;
      let fileExists = true;
      while (fileExists) {
        try {
          await subDir.getFileHandle(finalFileName, { create: false });
          finalFileName = `${cleanBase} (${counter})${ext}`;
          counter++;
        } catch {
          fileExists = false;
        }
      }
      if (finalFileName === oldFsName) return oldFsName;
    }

    const oldHandle: any = await subDir.getFileHandle(oldFsName);
    // Prefer a native move/rename (Chromium supports it for FILES) — atomic
    // and instant, and the only safe path for a case-only rename.
    if (typeof oldHandle.move === 'function') {
      try {
        await oldHandle.move(finalFileName);
        return finalFileName;
      } catch {}
    }
    if (caseOnly) return null; // never risk the copy fallback on the same entry

    // Fallback: copy bytes, THEN delete the original.
    const file = await oldHandle.getFile();
    const newHandle = await subDir.getFileHandle(finalFileName, { create: true });
    const writable = await newHandle.createWritable();
    await file.stream().pipeTo(writable);
    await subDir.removeEntry(oldFsName);
    return finalFileName;
  } catch (err) {
    return null;
  }
};

/* ------------------------------------------------------------------ *
 * Collections: one folder per collection under the project folder, a nested collection's inside
 * its parent's. Every `folder` below is such a path ("A", "A/B").
 * ------------------------------------------------------------------ */

const parentPath = (path: string): string => path.split('/').slice(0, -1).join('/');
const lastSegment = (path: string): string => path.split('/').pop() || path;

/** Moves everything in `from` into `to` — files, and folders (nested collections) with theirs. */
async function moveEntries(from: FileSystemDirectoryHandle, to: FileSystemDirectoryHandle): Promise<void> {
  // List first: moving entries out while iterating the folder can skip some.
  const entries: any[] = [];
  for await (const entry of (from as any).values()) entries.push(entry);
  for (const entry of entries) {
    if (entry.kind === 'directory') {
      await moveEntries(entry, await to.getDirectoryHandle(entry.name, { create: true }));
      continue;
    }
    const name = await freeName(to, entry.name);
    if (typeof entry.move === 'function') {
      try { await entry.move(to, name); continue; } catch {}
    }
    const file = await entry.getFile();
    const target = await to.getFileHandle(name, { create: true });
    const writable = await target.createWritable();
    await file.stream().pipeTo(writable);
  }
}

const projectDirFor = async ({ getActiveHandle, resolveCurrentProjectName }: DiskDeps, projectName: string, create: boolean): Promise<FileSystemDirectoryHandle | null> => {
  const rootHandle = await getActiveHandle();
  if (!rootHandle || !projectName) return null;
  const targetName = resolveCurrentProjectName(projectName);
  const mediaDir = await rootHandle.getDirectoryHandle(getProjectAreaFolder('media'), { create });
  const projectDir = await mediaDir.getDirectoryHandle(targetName, { create });
  if (create) await ensureProjectManifest(projectDir, targetName);
  return projectDir;
};

/** Makes `Media/<project>/<folder>/` for a new collection (its parents' folders too). */
export const ensureCollectionFolderOnDisk = async (deps: DiskDeps, projectName: string, folder: string): Promise<boolean> => {
  try {
    const projectDir = await projectDirFor(deps, projectName, true);
    if (!projectDir) return false;
    await dirAtPath(projectDir, folder, true);
    return true;
  } catch {
    return false;
  }
};

/**
 * Moves a media file between its kind folder and a collection folder (either way, or between two
 * collections). Returns the file's name in the destination — renumbered if the name was taken —
 * or null when the file or folder is not there. Prefers the native move; the copy fallback only
 * removes the original after the copy is complete.
 */
export const moveMediaFileOnDisk = async (
  deps: DiskDeps,
  projectName: string,
  kind: 'image' | 'video' | 'audio',
  fsName: string,
  fromFolder: string | undefined,
  toFolder: string | undefined,
): Promise<string | null> => {
  if (!fsName || (fromFolder || '') === (toFolder || '')) return fsName || null;
  try {
    const projectDir = await projectDirFor(deps, projectName, false);
    if (!projectDir) return null;
    const fromDir = await mediaDirFor(projectDir, kind, fromFolder);
    const toDir = await mediaDirFor(projectDir, kind, toFolder, true);
    const finalName = await freeName(toDir, fsName);
    const handle: any = await fromDir.getFileHandle(fsName);
    if (typeof handle.move === 'function') {
      try {
        await handle.move(toDir, finalName);
        return finalName;
      } catch {}
    }
    const file = await handle.getFile();
    const target = await toDir.getFileHandle(finalName, { create: true });
    const writable = await target.createWritable();
    await file.stream().pipeTo(writable);
    await fromDir.removeEntry(fsName);
    return finalName;
  } catch {
    return null;
  }
};

/**
 * Moves a collection's folder to a new path — a rename ("A" to "B"), or into another collection
 * ("A" to "C/A") — by moving what it holds, nested collections included, into the new folder and
 * then removing the old one.
 */
export const renameCollectionFolderOnDisk = async (deps: DiskDeps, projectName: string, oldFolder: string, newFolder: string): Promise<boolean> => {
  if (!oldFolder || !newFolder || oldFolder === newFolder) return true;
  // Into itself or its own child would remove what it just filled.
  if (newFolder.toLowerCase().startsWith(`${oldFolder.toLowerCase()}/`)) return false;
  try {
    const projectDir = await projectDirFor(deps, projectName, false);
    if (!projectDir) return false;
    let oldDir: FileSystemDirectoryHandle;
    try { oldDir = await dirAtPath(projectDir, oldFolder); } catch { return true; }
    const newDir = await dirAtPath(projectDir, newFolder, true);
    // A case-only rename on a case-insensitive filesystem resolves both names to one folder.
    if (await (oldDir as any).isSameEntry?.(newDir)) return true;
    await moveEntries(oldDir, newDir);
    await (await dirAtPath(projectDir, parentPath(oldFolder))).removeEntry(lastSegment(oldFolder), { recursive: true });
    return true;
  } catch {
    return false;
  }
};

/** Removes a collection's folder and everything in it, collections inside it included, into the
 *  Recycle Bin. */
export const deleteCollectionFolderOnDisk = async (deps: DiskDeps, projectName: string, folder: string): Promise<boolean> => {
  if (!folder) return false;
  try {
    const projectDir = await projectDirFor(deps, projectName, false);
    const root = await deps.getActiveHandle();
    if (!projectDir || !root) return false;
    const parent = parentPath(folder);
    const path = [getProjectAreaFolder('media'), deps.resolveCurrentProjectName(projectName), ...(parent ? parent.split('/') : [])];
    await moveToRecycleBin({ root, path }, await dirAtPath(projectDir, parent), lastSegment(folder));
    return true;
  } catch {
    return false;
  }
};

/**
 * Save a project cover image to disk at Media/<projectName>/cover.<ext>,
 * a sibling of the Images/ and Videos/ folders (NOT inside them). Accepts a
 * data URL or any fetchable URL; the body is read into a Blob and written.
 */
export const saveProjectCoverToDisk = async (
  { getActiveHandle, resolveCurrentProjectName }: DiskDeps,
  projectName: string,
  url: string,
): Promise<boolean> => {
  const rootHandle = await getActiveHandle();
  if (!rootHandle || !url) return false;

  try {
    const response = await fetch(url);
    const blob = await response.blob();

    const mediaDir = await rootHandle.getDirectoryHandle(getProjectAreaFolder('media'), { create: true });
    // Redirect through any in-flight rename (see saveLocalFSMedia).
    const targetName = resolveCurrentProjectName(projectName);
    const projectDir = await mediaDir.getDirectoryHandle(targetName, { create: true });
    await ensureProjectManifest(projectDir, targetName);

    // Pick an extension from the blob's mime type (default png for image covers).
    const ext = blob.type === 'image/jpeg' ? 'jpg'
      : blob.type === 'image/webp' ? 'webp'
      : blob.type === 'video/mp4' ? 'mp4'
      : 'png';

    // Keep a single cover.* at the project root: remove any stale variants.
    for (const name of ['cover.png', 'cover.jpg', 'cover.jpeg', 'cover.webp', 'cover.mp4']) {
      if (name === `cover.${ext}`) continue;
      try { await projectDir.removeEntry(name); } catch {}
    }

    const fileHandle = await projectDir.getFileHandle(`cover.${ext}`, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    return true;
  } catch (err) {
    return false;
  }
};
