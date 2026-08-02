import {
  getProjectStorageScope,
  readProjectRegistry,
  writeProjectRegistry,
  type ProjectRegistryEntry,
} from './registry';
import { renameCodeSessions } from '@willow/storage/indexeddb/willow-db';

export interface ProjectRenameResult {
  ok: boolean;
  changed: boolean;
  oldName?: string;
  newName?: string;
  error?: string;
  rolledBack?: boolean;
}

interface ProjectRenameDependencies {
  readRegistry: () => ProjectRegistryEntry[];
  writeRegistry: (projects: ProjectRegistryEntry[]) => void;
  renameSessions: (oldStorageKey: string, newStorageKey: string) => Promise<boolean>;
  notifyRegistryUpdated: () => void;
}

export interface TransactionalProjectRenameOptions {
  projectId: string;
  rawName: string;
  currentName?: string;
  isLocalFolderConnected: boolean;
  renameLocalFSProject: (oldName: string, newName: string) => Promise<boolean>;
  findProject?: (projects: ProjectRegistryEntry[]) => ProjectRegistryEntry | undefined;
  allowUnregistered?: boolean;
  commitRegistered?: (newName: string) => void;
  commitUnregistered?: (newName: string) => void;
  dependencies?: Partial<ProjectRenameDependencies>;
}

const inProcessRenameQueues = new Map<string, Promise<unknown>>();

function cleanProjectName(value: string): string {
  return value.replace(/[\/:*?"<>|]/g, '').trim();
}

function chooseUniqueName(
  requestedName: string,
  projects: ProjectRegistryEntry[],
  excludedProjectId?: string,
): string {
  let candidate = requestedName;
  let counter = 1;
  while (projects.some((project) =>
    project.id !== excludedProjectId && project.name.toLowerCase() === candidate.toLowerCase()
  )) {
    candidate = `${requestedName} (${counter})`;
    counter += 1;
  }
  return candidate;
}

async function withProjectRenameLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const lockName = `willow-project-rename:${getProjectStorageScope()}:${key}`;
  const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : undefined;
  if (locks?.request) return locks.request(lockName, operation);

  const previous = inProcessRenameQueues.get(lockName) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  inProcessRenameQueues.set(lockName, current);
  try {
    return await current;
  } finally {
    if (inProcessRenameQueues.get(lockName) === current) inProcessRenameQueues.delete(lockName);
  }
}

/**
 * Rename a project as one logical transaction across disk, session storage, and
 * the scoped registry. Disk is the gate when connected because it is the
 * authoritative project-name source. The registry is committed last.
 */
export async function transactionalRenameProject(
  options: TransactionalProjectRenameOptions,
): Promise<ProjectRenameResult> {
  const dependencies: ProjectRenameDependencies = {
    readRegistry: () => readProjectRegistry(),
    writeRegistry: (projects) => writeProjectRegistry(projects),
    renameSessions: renameCodeSessions,
    notifyRegistryUpdated: () => window.dispatchEvent(new Event('willow_projects_updated')),
    ...options.dependencies,
  };

  return withProjectRenameLock(options.projectId || options.currentName || 'unknown', async () => {
    const requestedName = cleanProjectName(options.rawName);
    if (!requestedName) return { ok: false, changed: false, error: 'Project name is empty.' };

    const initialProjects = dependencies.readRegistry();
    if (!Array.isArray(initialProjects)) {
      return { ok: false, changed: false, error: 'Project registry is unavailable.' };
    }
    const findProject = options.findProject ?? ((projects: ProjectRegistryEntry[]) =>
      projects.find((project) => project.id === options.projectId));
    const initialProject = findProject(initialProjects);
    if (!initialProject && !options.allowUnregistered) {
      return { ok: false, changed: false, error: 'Project no longer exists.' };
    }

    const oldName = initialProject?.name || options.currentName || '';
    if (!oldName) return { ok: false, changed: false, error: 'Current project name is unavailable.' };
    const newName = chooseUniqueName(requestedName, initialProjects, initialProject?.id);
    if (newName === oldName) return { ok: true, changed: false, oldName, newName };

    let diskRenamed = false;
    let sessionsRenamed = false;
    try {
      if (options.isLocalFolderConnected) {
        diskRenamed = await options.renameLocalFSProject(oldName, newName);
        if (!diskRenamed) throw new Error('The local project folder could not be renamed.');
      }

      sessionsRenamed = await dependencies.renameSessions(
        `willow_chat_sessions_${oldName}`,
        `willow_chat_sessions_${newName}`,
      );
      if (!sessionsRenamed) throw new Error('The project session history could not be renamed.');

      // Re-read after the async disk/session work so stars, covers, concurrent
      // additions, and other unrelated registry edits are never overwritten.
      const freshProjects = dependencies.readRegistry();
      const freshProject = findProject(freshProjects);
      if (initialProject) {
        if (!freshProject || freshProject.name !== oldName) {
          throw new Error('The project changed while it was being renamed.');
        }
        if (freshProjects.some((project) =>
          project.id !== freshProject.id && project.name.toLowerCase() === newName.toLowerCase()
        )) {
          throw new Error('Another project took that name while the rename was in progress.');
        }
        dependencies.writeRegistry(freshProjects.map((project) =>
          project.id === freshProject.id ? { ...project, name: newName } : project
        ));
        // The registry is the final durable commit. UI callbacks/events are
        // best-effort notifications after that point and must never trigger a
        // compensating rollback of already-committed storage.
        try { options.commitRegistered?.(newName); } catch {}
        try { dependencies.notifyRegistryUpdated(); } catch {}
      } else {
        if (!options.allowUnregistered || !options.commitUnregistered) {
          throw new Error('The unregistered project cannot commit its new name.');
        }
        if (freshProjects.some((project) => project.name.toLowerCase() === newName.toLowerCase())) {
          throw new Error('Another project took that name while the rename was in progress.');
        }
        options.commitUnregistered(newName);
      }

      return { ok: true, changed: true, oldName, newName };
    } catch (error) {
      // Restore the authoritative disk name first. Only after that succeeds is
      // it safe to move sessions back to the old registry key.
      let diskRolledBack = !diskRenamed;
      if (diskRenamed) {
        try { diskRolledBack = await options.renameLocalFSProject(newName, oldName); } catch { diskRolledBack = false; }
      }
      let sessionsRolledBack = !sessionsRenamed;
      if (sessionsRenamed && diskRolledBack) {
        try {
          sessionsRolledBack = await dependencies.renameSessions(
            `willow_chat_sessions_${newName}`,
            `willow_chat_sessions_${oldName}`,
          );
        } catch {
          sessionsRolledBack = false;
        }
      }
      return {
        ok: false,
        changed: false,
        oldName,
        newName,
        error: error instanceof Error ? error.message : 'Project rename failed.',
        rolledBack: diskRolledBack && sessionsRolledBack,
      };
    }
  });
}
