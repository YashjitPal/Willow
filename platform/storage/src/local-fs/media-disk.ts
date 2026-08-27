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
import type { DiskDeps } from './disk-deps';

registerProjectArea({ id: 'media', folder: 'Media', kind: 'media', priority: 20 });

/**
 * Save media creations locally
 */
export const saveMediaFileToDisk = async (
  { getActiveHandle, getSanitizedWorkspaceName, resolveCurrentProjectName }: DiskDeps,
  projectName: string,
  kind: 'image' | 'video' | 'audio',
  fileName: string,
  blob: Blob,
): Promise<string | null> => {
  const rootHandle = await getActiveHandle();
  if (!rootHandle) return null;

  try {
    // Redirect through any in-flight rename — generation/backfill saves hold
    // the name across multi-second fetches; a stale name here resurrected
    // Media/<oldName>/ as a phantom project (or wrote into the folder
    // mid-move, where the copy-then-delete rename then destroyed the file).
    const targetName = resolveCurrentProjectName(projectName);
    const workspaceName = getSanitizedWorkspaceName();
    const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName, { create: true });
    const mediaDir = await workspaceDir.getDirectoryHandle(getProjectAreaFolder('media'), { create: true });
    const projectDir = await mediaDir.getDirectoryHandle(targetName, { create: true });

    // Persist the stable project id alongside the media so re-discovery keeps it.
    await ensureProjectManifest(projectDir, targetName);

    // Pre-create Scenes and Music directories
    await projectDir.getDirectoryHandle('Scenes', { create: true });
    await projectDir.getDirectoryHandle('Music', { create: true });
    
    // Write file to Images or Videos or Audio subfolder
    const subFolder = kind === 'image' ? 'Images' : kind === 'video' ? 'Videos' : 'Audio';
    const subDir = await projectDir.getDirectoryHandle(subFolder, { create: true });
    
    // If image kind, also pre-create "Characters" subfolder
    if (kind === 'image') {
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
  { getActiveHandle, getSanitizedWorkspaceName, resolveCurrentProjectName }: DiskDeps,
  projectName: string,
  kind: 'image' | 'video' | 'audio',
  fsName: string,
): Promise<boolean> => {
  if (!projectName || !fsName) return false;
  const rootHandle = await getActiveHandle();
  if (!rootHandle) return false;
  try {
    const workspaceName = getSanitizedWorkspaceName();
    // Deletion is a targeted operation — never create folders on the way.
    // Redirect through any in-flight rename so deletes chase the moved folder.
    const targetName = resolveCurrentProjectName(projectName);
    const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName);
    const mediaDir = await workspaceDir.getDirectoryHandle(getProjectAreaFolder('media'));
    const projectDir = await mediaDir.getDirectoryHandle(targetName);
    // NOTE: audio artifacts live in Audio/ — this mapped audio to Videos/,
    // so deleting a song left its file behind (and once Audio/ became part of
    // the reconcile scan, the leftover file would resurrect the tile).
    const subDir = await projectDir.getDirectoryHandle(kind === 'image' ? 'Images' : kind === 'video' ? 'Videos' : 'Audio');
    await subDir.removeEntry(fsName);
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
  { getActiveHandle, getSanitizedWorkspaceName, resolveCurrentProjectName }: DiskDeps,
  projectName: string,
  kind: 'image' | 'video' | 'audio',
  oldFsName: string,
  newBaseName: string,
): Promise<string | null> => {
  if (!projectName || !oldFsName || !newBaseName?.trim()) return null;
  const rootHandle = await getActiveHandle();
  if (!rootHandle) return null;
  try {
    const workspaceName = getSanitizedWorkspaceName();
    // Rename is a targeted operation — never create folders on the way.
    // Redirect through any in-flight project rename.
    const targetName = resolveCurrentProjectName(projectName);
    const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName);
    const mediaDir = await workspaceDir.getDirectoryHandle(getProjectAreaFolder('media'));
    const projectDir = await mediaDir.getDirectoryHandle(targetName);
    const subDir = await projectDir.getDirectoryHandle(kind === 'image' ? 'Images' : kind === 'video' ? 'Videos' : 'Audio');

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

/**
 * Save a project cover image to disk at Media/<projectName>/cover.<ext>,
 * a sibling of the Images/ and Videos/ folders (NOT inside them). Accepts a
 * data URL or any fetchable URL; the body is read into a Blob and written.
 */
export const saveProjectCoverToDisk = async (
  { getActiveHandle, getSanitizedWorkspaceName, resolveCurrentProjectName }: DiskDeps,
  projectName: string,
  url: string,
): Promise<boolean> => {
  const rootHandle = await getActiveHandle();
  if (!rootHandle || !url) return false;

  try {
    const response = await fetch(url);
    const blob = await response.blob();

    const workspaceName = getSanitizedWorkspaceName();
    const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName, { create: true });
    const mediaDir = await workspaceDir.getDirectoryHandle(getProjectAreaFolder('media'), { create: true });
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
