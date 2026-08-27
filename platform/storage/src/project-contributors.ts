/**
 * Project folder contributors.
 *
 * A saved Code project is not owned by one feature: the Code editor writes the
 * source tree and future features may want their own sub-folders. Rather than
 * have the storage layer import every feature (which
 * inverts the dependency arrow and makes `platform/` un-testable in isolation),
 * features *register* a writer here and the sync engine calls it.
 *
 * Registration is a module side effect, so a feature's writer only exists when
 * the app actually loads that feature. `apps/studio/src/app/register-features.ts`
 * is the single place that pulls them in.
 *
 * See ARCHITECTURE.md §7 (lifecycle flows) for where this runs in a save.
 */

export interface ProjectFolderWriteContext {
  /** Folder name of the project being saved, e.g. "My App". */
  projectName: string;
  /**
   * Create/overwrite a file inside the contributor's own sub-folder.
   * Nested paths ("nested/file.tsx") are created recursively.
   */
  writeFile: (relativePath: string, contents: string) => Promise<void>;
}

export interface ProjectFolderWriter {
  /**
   * Sub-folder under `Code/<project>/` this contributor owns.
   * The folder is emptied before `write` runs, so the contributor always
   * produces the complete, current contents.
   */
  folder: string;
  /** Write this contributor's files. Must not throw; errors are logged. */
  write: (ctx: ProjectFolderWriteContext) => Promise<void>;
}

const writers = new Map<string, ProjectFolderWriter>();

/**
 * Register (or replace) a contributor. `id` keeps registration idempotent under
 * hot-module reload — re-importing a feature must not double-write.
 */
export function registerProjectFolderWriter(id: string, writer: ProjectFolderWriter): void {
  const cleanId = id.trim();
  const folder = writer.folder.trim();
  if (!cleanId) throw new Error('Project folder writer id cannot be empty');
  if (!folder || folder.includes('\\') || folder.split('/').some((segment) => !segment.trim() || segment === '.' || segment === '..')) {
    throw new Error(`Project folder writer "${id}": folder must be a safe relative path`);
  }
  for (const [existingId, existing] of writers) {
    if (existingId !== cleanId && existing.folder.toLowerCase() === folder.toLowerCase()) {
      throw new Error(`Project folder writer folder "${folder}" is already owned by "${existingId}"`);
    }
  }
  writers.set(cleanId, { ...writer, folder });
}

export function unregisterProjectFolderWriter(id: string): void {
  writers.delete(id);
}

export function getProjectFolderWriters(): ProjectFolderWriter[] {
  return [...writers.values()];
}
