/**
 * Project folder contributors.
 *
 * A saved project is not owned by one feature: the Code editor writes the
 * source tree, Design writes its nodes, and future features will want their own
 * sub-folders. Rather than have the storage layer import every feature (which
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
   * Sub-folder under `Code/<project>/` this contributor owns, e.g. "Designs".
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
  writers.set(id, writer);
}

export function unregisterProjectFolderWriter(id: string): void {
  writers.delete(id);
}

export function getProjectFolderWriters(): ProjectFolderWriter[] {
  return [...writers.values()];
}
