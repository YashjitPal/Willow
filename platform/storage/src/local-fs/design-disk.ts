/** Write a Design project to the workspace's top-level Design/ folder. */

import { writeFileRecursively } from '../adapters/local-disk';
import { ensureProjectManifest } from './project-manifest';
import { getProjectAreaFolder } from './project-areas';
import type { DiskDeps } from './disk-deps';
import type { FileContent } from './code-disk';

const normalize = (path: string): string =>
  path.replace(/\\/g, '/').replace(/^\//, '').split('/').filter((part) => part !== '.' && part !== '..').join('/');

export const saveDesignProjectToDisk = async (
  { getActiveHandle, getSanitizedWorkspaceName, resolveCurrentProjectName }: DiskDeps,
  projectName: string,
  files: FileContent[],
): Promise<boolean> => {
  const rootHandle = await getActiveHandle();
  if (!rootHandle) return false;

  try {
    const targetName = resolveCurrentProjectName(projectName);
    const workspaceDir = await rootHandle.getDirectoryHandle(getSanitizedWorkspaceName(), { create: true });
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
