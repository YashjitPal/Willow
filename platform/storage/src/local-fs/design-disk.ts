/** Write a Design project to the workspace's top-level Design/ folder. */

import { writeFileRecursively } from '../adapters/local-disk';
import { ensureProjectManifest } from './project-manifest';
import { getProjectAreaFolder } from './project-areas';
import type { DiskDeps } from './disk-deps';
import type { FileContent } from './code-disk';

const normalize = (path: string): string =>
  path.replace(/\\/g, '/').replace(/^\//, '').split('/').filter((part) => part !== '.' && part !== '..').join('/');

export const saveDesignProjectToDisk = async (
  { getActiveHandle, resolveCurrentProjectName }: DiskDeps,
  projectName: string,
  files: FileContent[],
): Promise<boolean> => {
  const rootHandle = await getActiveHandle();
  if (!rootHandle) return false;

  try {
    const targetName = resolveCurrentProjectName(projectName);
    const workspaceDir = rootHandle;
    const designDir = await workspaceDir.getDirectoryHandle(getProjectAreaFolder('design'), { create: true });
    const projectDir = await designDir.getDirectoryHandle(targetName, { create: true });
    await ensureProjectManifest(projectDir, targetName);

    const written = new Set<string>();
    for (const file of files) {
      const relative = normalize(file.name);
      if (!relative) continue;
      await writeFileRecursively(projectDir, relative, file.content);
      written.add(relative);
    }

    // Write first, then prune stale non-hidden entries. A failed save can leave
    // harmless extras, but never an empty or partially rewritten project.
    const prune = async (dir: any, prefix: string): Promise<boolean> => {
      const filesOnDisk: string[] = [];
      const dirsOnDisk: { name: string; handle: any }[] = [];
      let kept = 0;
      for await (const entry of dir.values()) {
        if (entry.name.startsWith('.')) { kept++; continue; }
        if (entry.kind === 'directory') dirsOnDisk.push({ name: entry.name, handle: entry });
        else filesOnDisk.push(entry.name);
      }
      for (const name of filesOnDisk) {
        const relative = prefix ? `${prefix}/${name}` : name;
        if (written.has(relative)) kept++;
        else { try { await dir.removeEntry(name); } catch {} }
      }
      for (const child of dirsOnDisk) {
        const childPrefix = prefix ? `${prefix}/${child.name}` : child.name;
        if (await prune(child.handle, childPrefix)) kept++;
        else { try { await dir.removeEntry(child.name, { recursive: true }); } catch {} }
      }
      return kept > 0;
    };
    await prune(projectDir, '');
    return true;
  } catch {
    return false;
  }
};

/** One file of a Design project, written alone: the project's other files stay as they are. */
export const writeDesignProjectFile = async (
  { getActiveHandle, resolveCurrentProjectName }: DiskDeps,
  projectName: string,
  path: string,
  content: string,
): Promise<boolean> => {
  const rootHandle = await getActiveHandle();
  const relative = normalize(path);
  if (!rootHandle || !relative) return false;
  try {
    const targetName = resolveCurrentProjectName(projectName);
    const designDir = await rootHandle.getDirectoryHandle(getProjectAreaFolder('design'), { create: true });
    const projectDir = await designDir.getDirectoryHandle(targetName, { create: true });
    await ensureProjectManifest(projectDir, targetName);
    await writeFileRecursively(projectDir, relative, content);
    return true;
  } catch {
    return false;
  }
};

/**
 * A file of a Design project: `null` when there is no folder, project or file. Any other failure
 * throws, so a caller can't take a file it couldn't read for one that isn't there and write over it.
 */
export const readDesignProjectFile = async (
  { getActiveHandle, resolveCurrentProjectName }: DiskDeps,
  projectName: string,
  path: string,
): Promise<string | null> => {
  const rootHandle = await getActiveHandle();
  const parts = normalize(path).split('/').filter(Boolean);
  const name = parts.pop();
  if (!rootHandle || !name) return null;
  try {
    let dir = await rootHandle.getDirectoryHandle(getProjectAreaFolder('design'));
    dir = await dir.getDirectoryHandle(resolveCurrentProjectName(projectName));
    for (const part of parts) dir = await dir.getDirectoryHandle(part);
    return await (await (await dir.getFileHandle(name)).getFile()).text();
  } catch (error) {
    if ((error as { name?: string } | null)?.name === 'NotFoundError') return null;
    throw error;
  }
};
