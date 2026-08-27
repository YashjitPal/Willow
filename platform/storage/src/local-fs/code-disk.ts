/**
 * Writing a project's Code/ folder to the local disk.
 *
 * The counterpart to ./media-disk. Lifted out of LocalFSProvider because these
 * close over nothing but the helpers they now receive as `deps`; the provider
 * still wraps each in a useCallback with its original dependency array, so the
 * context value identity is unchanged.
 *
 * Both swallow their errors and report failure through the return value: a
 * project save is a background sync, so the caller keeps its in-memory state
 * and retries rather than failing the edit that triggered it.
 */

import { writeFileRecursively } from '../adapters/local-disk';
import { getProjectFolderWriters } from '../project-contributors';
import { getProjectAreaFolder, registerProjectArea } from './project-areas';
import { ensureProjectManifest } from './project-manifest';
import type { DiskDeps } from './disk-deps';

registerProjectArea({ id: 'code', folder: 'Code', kind: 'code', priority: 30 });

/** One file in a project, addressed by its path relative to the project root. */
export interface FileContent {
  name: string;
  content: string;
}

/**
 * Save project files locally
 */
export const saveProjectFilesToDisk = async (
  { getActiveHandle, getSanitizedWorkspaceName, resolveCurrentProjectName }: DiskDeps,
  projectName: string,
  files: FileContent[],
): Promise<boolean> => {
  const rootHandle = await getActiveHandle();
  if (!rootHandle) return false;

  try {
    // Redirect through any in-flight rename — a save captured the name
    // before the rename landed and would otherwise resurrect the old folder.
    const targetName = resolveCurrentProjectName(projectName);
    const workspaceName = getSanitizedWorkspaceName();
    const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName, { create: true });
    const codeDir = await workspaceDir.getDirectoryHandle(getProjectAreaFolder('code'), { create: true });
    const projectDir = await codeDir.getDirectoryHandle(targetName, { create: true });

    // Persist the stable project id alongside the code so re-discovery keeps it.
    await ensureProjectManifest(projectDir, targetName);

    // Create the Code-owned subfolders. Design projects live separately under
    // the workspace's top-level Design/ folder.
    const codebaseDir = await projectDir.getDirectoryHandle('Codebase', { create: true });
    await projectDir.getDirectoryHandle('Chat sessions', { create: true });
    await projectDir.getDirectoryHandle('Agents', { create: true });

    // Write the new file set FIRST, then prune stale entries — never the other
    // way round. The old code deleted the whole Codebase/ tree up front and
    // then rewrote file-by-file; an interruption in that window (tab close,
    // crash, permission downgrade, the unmount-flush firing mid-teardown)
    // left Codebase/ empty or truncated on disk. Write-then-prune means an
    // interruption at worst leaves a few extra stale files, never an empty
    // tree, and the next successful save cleans them up.
    const writtenPaths = new Set<string>();
    // Mirror writeFileRecursively's own normalization EXACTLY so the prune
    // pass below recognises each just-written file: backslashes → '/', drop a
    // leading '/', and drop '.'/'..' path segments (it skips those when
    // creating dirs, so the on-disk path has them removed too).
    const normalizeWritten = (p: string): string =>
      p.replace(/\\/g, '/').replace(/^\//, '').split('/').filter((s) => s !== '.' && s !== '..').join('/');
    for (const file of files) {
      await writeFileRecursively(codebaseDir, file.name, file.content);
      writtenPaths.add(normalizeWritten(file.name));
    }

    // Prune files no longer in the editor's set (handles deletes/renames),
    // recursively. Dot-entries (.git, .vscode, …) are user-owned — never
    // touched. Empty non-dot directories left after pruning are removed too.
    const pruneStale = async (dir: any, prefix: string): Promise<boolean> => {
      // Returns true if `dir` still holds anything after pruning. Collect the
      // full entry list BEFORE mutating — removing during the async
      // directory iteration can skip siblings on some implementations.
      const files: string[] = [];
      const childDirs: { name: string; handle: any }[] = [];
      let kept = 0;
      for await (const entry of dir.values()) {
        if (typeof entry.name === 'string' && entry.name.startsWith('.')) { kept++; continue; }
        if (entry.kind === 'directory') childDirs.push({ name: entry.name, handle: entry });
        else files.push(entry.name);
      }
      for (const name of files) {
        const rel = prefix ? `${prefix}/${name}` : name;
        if (writtenPaths.has(rel)) { kept++; }
        else { try { await dir.removeEntry(name); } catch {} }
      }
      for (const child of childDirs) {
        const childPrefix = prefix ? `${prefix}/${child.name}` : child.name;
        const childKept = await pruneStale(child.handle, childPrefix);
        if (childKept) { kept++; }
        else { try { await dir.removeEntry(child.name, { recursive: true }); } catch {} }
      }
      return kept > 0;
    };
    try {
      await pruneStale(codebaseDir, '');
    } catch {}

    // Let feature contributors write their own Code sub-folders.
    // Each folder is emptied first so a contributor always produces the
    // complete current contents. See project-contributors.ts.
    for (const writer of getProjectFolderWriters()) {
      try {
        const dir = await projectDir.getDirectoryHandle(writer.folder, { create: true });
        for await (const entry of (dir as any).values()) {
          if (entry.kind === 'file') await dir.removeEntry(entry.name);
        }
        await writer.write({
          projectName: targetName,
          writeFile: (relativePath, contents) => writeFileRecursively(dir, relativePath, contents),
        });
      } catch {}
    }

    return true;
  } catch (err) {
    return false;
  }
};

/**
 * Save codebase/design chat sessions of respective project locally
 */
export const saveProjectChatToDisk = async (
  { getActiveHandle, getSanitizedWorkspaceName, resolveCurrentProjectName }: DiskDeps,
  projectName: string,
  chatId: string,
  messages: any[],
  oldChatId?: string | null,
): Promise<boolean> => {
  const rootHandle = await getActiveHandle();
  if (!rootHandle) return false;

  try {
    // Redirect through any in-flight rename (see saveLocalFSProject).
    const targetName = resolveCurrentProjectName(projectName);
    const workspaceName = getSanitizedWorkspaceName();
    const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName, { create: true });
    const codeDir = await workspaceDir.getDirectoryHandle(getProjectAreaFolder('code'), { create: true });
    const projectDir = await codeDir.getDirectoryHandle(targetName, { create: true });
    const chatSessionsDir = await projectDir.getDirectoryHandle('Chat sessions', { create: true });
    
    const chatContent = JSON.stringify(messages, null, 2);
    await writeFileRecursively(chatSessionsDir, `${chatId}.json`, chatContent);
    
    if (oldChatId && oldChatId !== chatId) {
      try {
        await chatSessionsDir.removeEntry(`${oldChatId}.json`);
      } catch {}
    }
    return true;
  } catch (err) {
    return false;
  }
};
