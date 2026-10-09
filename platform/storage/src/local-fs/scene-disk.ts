/**
 * A Media project's scenes on disk: `Media/<project>/Scenes/<name>.json`, one small file each.
 * What goes in them is the Media feature's (`features/media/src/scenes/scene-files.ts`); this only
 * reads, writes, renames and removes the files. Like ./media-disk, failures come back as return
 * values: a scene write is a background sync, made again on the scene's next change.
 */

import { ensureProjectManifest } from './project-manifest';
import { getProjectAreaFolder } from './project-areas';
import { safeFileStem } from './conversation-files';
import { moveToRecycleBin } from './recycle-bin';
import type { DiskDeps } from './disk-deps';

export const SCENES_FOLDER = 'Scenes';
const EXT = '.json';
/** Larger than any scene file; anything bigger in Scenes/ is not one. */
const MAX_SCENE_FILE_BYTES = 2_000_000;

export interface SceneFileOnDisk {
  fsName: string;
  text: string;
}

async function scenesDir({ getActiveHandle, resolveCurrentProjectName }: DiskDeps, projectName: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
  const rootHandle = await getActiveHandle();
  if (!rootHandle || !projectName) return null;
  // Redirect through any in-flight project rename, as every media write does.
  const targetName = resolveCurrentProjectName(projectName);
  const mediaDir = await rootHandle.getDirectoryHandle(getProjectAreaFolder('media'), { create });
  const projectDir = await mediaDir.getDirectoryHandle(targetName, { create });
  if (create) await ensureProjectManifest(projectDir, targetName);
  return projectDir.getDirectoryHandle(SCENES_FOLDER, { create });
}

/** Every scene file in the project's Scenes/; [] when it has none, null when the folder can't be read. */
export const readSceneFilesFromDisk = async (deps: DiskDeps, projectName: string): Promise<SceneFileOnDisk[] | null> => {
  let dir: FileSystemDirectoryHandle | null;
  try {
    dir = await scenesDir(deps, projectName, false);
  } catch (error: any) {
    return error?.name === 'NotFoundError' ? [] : null;
  }
  if (!dir) return null;
  const out: SceneFileOnDisk[] = [];
  try {
    for await (const entry of (dir as any).values()) {
      const name = entry.name as string;
      if (entry.kind !== 'file' || name.startsWith('.') || !name.toLowerCase().endsWith(EXT)) continue;
      try {
        const file: File = await entry.getFile();
        if (file.size <= MAX_SCENE_FILE_BYTES) out.push({ fsName: name, text: await file.text() });
      } catch {}
    }
  } catch {
    return null;
  }
  return out;
};

/** "Name (2).json" and "Name.json" are the same scene name. */
const withoutCounter = (fsName: string): string => fsName.replace(/ \(\d+\)(\.json)$/i, '$1').toLowerCase();

async function exists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes a scene's file and returns its name. A scene keeps its file while its name stays the
 * same; a renamed one moves to `<name>.json` ("name (1).json" when another scene has that), the
 * old file removed once the new one is complete.
 */
export const writeSceneFileToDisk = async (
  deps: DiskDeps,
  projectName: string,
  previous: string | undefined,
  sceneName: string,
  text: string,
): Promise<string | null> => {
  try {
    const dir = await scenesDir(deps, projectName, true);
    if (!dir) return null;
    const stem = safeFileStem(sceneName, 'Scene');
    let name = previous && withoutCounter(previous) === `${stem}${EXT}`.toLowerCase() ? previous : `${stem}${EXT}`;
    if (name !== previous) {
      for (let n = 1; (await exists(dir, name)) && name.toLowerCase() !== previous?.toLowerCase(); n += 1) name = `${stem} (${n})${EXT}`;
    }
    const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await writable.write(text);
    await writable.close();
    if (previous && previous.toLowerCase() !== name.toLowerCase()) {
      try { await dir.removeEntry(previous); } catch {}
    }
    return name;
  } catch {
    return null;
  }
};

/** Removes a scene's file; true once it is gone, or was never there. */
export const deleteSceneFileFromDisk = async (deps: DiskDeps, projectName: string, fsName: string): Promise<boolean> => {
  if (!fsName) return true;
  try {
    const dir = await scenesDir(deps, projectName, false);
    const root = await deps.getActiveHandle();
    if (!dir || !root) return false;
    await moveToRecycleBin({ root, path: [getProjectAreaFolder('media'), deps.resolveCurrentProjectName(projectName), SCENES_FOLDER] }, dir, fsName);
    return true;
  } catch (error: any) {
    return error?.name === 'NotFoundError';
  }
};
