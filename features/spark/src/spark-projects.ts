/**
 * Spark's folders in the desktop app, and what each task may do without asking.
 *
 * A folder is a project: a place on this computer the user added from the
 * sidebar, whose tasks work in it. A task started anywhere else works across the
 * whole computer, from the home folder.
 *
 * Desktop only, and kept on this computer rather than with the tasks: a folder is
 * a path on one machine, so the same task opened on the web, or on another
 * computer, simply has no folder.
 *
 * Also here, because they are scoped the same way:
 *
 * - **Approval policy.** Codex's `unless-trusted` ("ask") or `never` with full
 *   access ("full"), per task, defaulting to the folder's setting.
 * - **Approved prefixes.** Codex's "don't ask again for commands that start
 *   with…", kept per folder (and once for tasks with no folder), as Codex keeps
 *   its rules across sessions.
 * - **Pending approvals**, by task. A separate atom for the reason
 *   `sparkPendingQuestions` is one: it holds promise resolvers, and nothing here
 *   may outlive the run waiting on it.
 */

import { atom } from 'nanostores';
import {
  allowedByRules,
  type NativeApprovalDecision,
  type NativeApprovalMode,
  type NativeApprovalRequest,
  type NativeApprovals,
} from './harness/native/native-approvals';
import { getActiveSparkStorageScope, sparkHydrationScope, sparkState, updateSparkTask } from './spark-store';

export interface SparkProject {
  id: string;
  /** The folder's own name. */
  name: string;
  /** Absolute, as the folder picker returned it. */
  path: string;
  addedAt: number;
  /** Tasks in this folder run commands without asking unless they say otherwise. */
  fullAccess?: boolean;
  /** Approved command prefixes, each as its words: `["npm", "test"]`. */
  rules?: string[][];
}

export interface SparkProjectsState {
  projects: SparkProject[];
  /** Task id to folder id. */
  taskProjects: Record<string, string>;
  /** A task's own approval policy, once the user set one. */
  taskModes: Record<string, NativeApprovalMode>;
  /** Approved prefixes for tasks with no folder. */
  globalRules: string[][];
  /** The folder the next task from the composer works in. Null works across the computer. */
  activeProjectId: string | null;
  /** Folders whose sidebar section is folded. */
  collapsed: Record<string, true>;
}

const EMPTY: SparkProjectsState = {
  projects: [],
  taskProjects: {},
  taskModes: {},
  globalRules: [],
  activeProjectId: null,
  collapsed: {},
};

export const sparkProjects = atom<SparkProjectsState>(EMPTY);

const storageKey = (scope: string) => `willow:spark:projects:v1:${encodeURIComponent(scope || 'guest')}`;

/** The loaded state and the scope it belongs to. Read through `current()`, written through `commit()`. */
let cache: { scope: string; state: SparkProjectsState } | null = null;

const isRule = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every((part) => typeof part === 'string' && part.length > 0);

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Folders and approvals as stored, or as `settings.json` has them: whatever isn't well formed is dropped. */
const normalizeState = (value: unknown): SparkProjectsState => {
  const saved = (isObject(value) ? value : {}) as Partial<SparkProjectsState>;
  const projects = (Array.isArray(saved.projects) ? saved.projects : [])
    .filter((project): project is SparkProject => Boolean(project && typeof project.id === 'string' && typeof project.path === 'string'))
    .map((project) => ({ ...project, name: project.name || folderName(project.path), rules: (Array.isArray(project.rules) ? project.rules : []).filter(isRule) }));
  const ids = new Set(projects.map((project) => project.id));
  return {
    projects,
    taskProjects: Object.fromEntries(Object.entries(isObject(saved.taskProjects) ? saved.taskProjects : {}).filter(([, id]) => ids.has(id))),
    taskModes: Object.fromEntries(Object.entries(isObject(saved.taskModes) ? saved.taskModes : {}).filter(([, mode]) => mode === 'ask' || mode === 'full')),
    globalRules: (Array.isArray(saved.globalRules) ? saved.globalRules : []).filter(isRule),
    activeProjectId: typeof saved.activeProjectId === 'string' && ids.has(saved.activeProjectId) ? saved.activeProjectId : null,
    collapsed: Object.fromEntries(Object.entries(isObject(saved.collapsed) ? saved.collapsed : {}).filter(([id]) => ids.has(id))) as Record<string, true>,
  };
};

const readState = (scope: string): SparkProjectsState => {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(scope));
    return raw ? normalizeState(JSON.parse(raw)) : EMPTY;
  } catch {
    return EMPTY;
  }
};

/**
 * The state for the signed-in Spark scope, read from storage the first time it is
 * needed. Readers can be mid-render, so the atom is published after the read
 * rather than during it.
 */
const current = (): SparkProjectsState => {
  const scope = getActiveSparkStorageScope();
  if (!cache || cache.scope !== scope) {
    const loaded = { scope, state: readState(scope) };
    cache = loaded;
    queueMicrotask(() => {
      if (cache === loaded) sparkProjects.set(loaded.state);
    });
  }
  return cache.state;
};

const commit = (next: SparkProjectsState): void => {
  const scope = cache?.scope ?? getActiveSparkStorageScope();
  cache = { scope, state: next };
  sparkProjects.set(next);
  try {
    globalThis.localStorage?.setItem(storageKey(scope), JSON.stringify(next));
  } catch {
    // Storage can be unavailable in private or embedded contexts; the session keeps working.
  }
};

// A different account has its own folders.
sparkHydrationScope.subscribe((scope) => {
  if (!scope || cache?.scope === scope) return;
  cache = { scope, state: readState(scope) };
  sparkProjects.set(cache.state);
});

/** Loads the folders for the current scope. Components call it once on mount. */
export const ensureSparkProjectsLoaded = (): void => {
  current();
};

/** The folders and approvals of the signed-in Spark scope, read now rather than when the atom next publishes. */
export const readSparkProjects = (): SparkProjectsState => current();

/** Folders and approvals as `settings.json` has them (`normalizeState` narrows them). */
export const replaceSparkProjects = (value: unknown): void => {
  const next = normalizeState(value);
  if (JSON.stringify(next) !== JSON.stringify(current())) commit(next);
};

const folderName = (path: string): string => {
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed.slice(Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/')) + 1) || trimmed;
};

const samePath = (a: string, b: string): boolean => {
  const normalize = (value: string) => value.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase();
  return /^[a-zA-Z]:/.test(a) || a.startsWith('\\\\') ? normalize(a) === normalize(b) : a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
};

const newId = (): string => `folder_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/* ------------------------------------------------------------------------ */
/* Folders                                                                   */
/* ------------------------------------------------------------------------ */

/** Adds a folder, or returns the one already added for that path. */
export const addSparkProject = (path: string): SparkProject => {
  const state = current();
  const existing = state.projects.find((project) => samePath(project.path, path));
  if (existing) {
    const { [existing.id]: _, ...collapsed } = state.collapsed;
    commit({ ...state, collapsed });
    return existing;
  }
  const project: SparkProject = { id: newId(), name: folderName(path), path, addedAt: Date.now(), rules: [] };
  commit({ ...state, projects: [...state.projects, project] });
  return project;
};

/**
 * Removes a folder from Spark. Its tasks stay, and work across the computer if
 * continued; nothing on disk is touched.
 */
export const removeSparkProject = (projectId: string): void => {
  const state = current();
  const { [projectId]: _, ...collapsed } = state.collapsed;
  commit({
    ...state,
    projects: state.projects.filter((project) => project.id !== projectId),
    taskProjects: Object.fromEntries(Object.entries(state.taskProjects).filter(([, id]) => id !== projectId)),
    activeProjectId: state.activeProjectId === projectId ? null : state.activeProjectId,
    collapsed,
  });
};

export const toggleSparkProjectCollapsed = (projectId: string): void => {
  const state = current();
  const { [projectId]: wasCollapsed, ...rest } = state.collapsed;
  commit({ ...state, collapsed: wasCollapsed ? rest : { ...rest, [projectId]: true } });
};

export const setSparkProjectFullAccess = (projectId: string, fullAccess: boolean): void => {
  const state = current();
  commit({ ...state, projects: state.projects.map((project) => (project.id === projectId ? { ...project, fullAccess } : project)) });
};

/** Set by a folder's "New task" so the home composer takes the cursor once it is on screen. */
export const sparkComposerFocusRequest = atom(0);

/** Opens a new task in a folder: the composer, set to that folder, with the cursor in it. */
export const startSparkTaskInProject = (projectId: string): void => {
  setSparkActiveProject(projectId);
  sparkComposerFocusRequest.set(sparkComposerFocusRequest.get() + 1);
};

/** Where the next task from the composer works: a folder, or null for the whole computer. */
export const setSparkActiveProject = (projectId: string | null): void => {
  const state = current();
  if (state.activeProjectId === projectId) return;
  commit({ ...state, activeProjectId: projectId && state.projects.some((project) => project.id === projectId) ? projectId : null });
};

/** Files a new task under the folder the composer is set to, if any. */
export const claimSparkTaskProject = (taskId: string): SparkProject | null => {
  const state = current();
  const project = state.projects.find((entry) => entry.id === state.activeProjectId) ?? null;
  if (project) commit({ ...state, taskProjects: { ...state.taskProjects, [taskId]: project.id } });
  return project;
};

/**
 * Files a task under the folder at `path`, adding the folder to Spark if it is new. For tasks assigned from outside
 * the composer — by a dot — that should work in a particular folder; the composer's own tasks claim theirs above.
 */
export const fileSparkTaskInFolder = (taskId: string, path: string): SparkProject => {
  const project = addSparkProject(path);
  const state = current();
  commit({ ...state, taskProjects: { ...state.taskProjects, [taskId]: project.id } });
  return project;
};

export const sparkTaskProject = (taskId: string): SparkProject | null => {
  const state = current();
  const id = state.taskProjects[taskId];
  return id ? state.projects.find((project) => project.id === id) ?? null : null;
};

/* ------------------------------------------------------------------------ */
/* Approval policy                                                           */
/* ------------------------------------------------------------------------ */

export const sparkTaskApprovalMode = (taskId: string): NativeApprovalMode => {
  const state = current();
  const own = state.taskModes[taskId];
  if (own) return own;
  return sparkTaskProject(taskId)?.fullAccess ? 'full' : 'ask';
};

export const setSparkTaskApprovalMode = (taskId: string, mode: NativeApprovalMode): void => {
  const state = current();
  commit({ ...state, taskModes: { ...state.taskModes, [taskId]: mode } });
};

const rulesFor = (taskId: string): string[][] => {
  const project = sparkTaskProject(taskId);
  return project ? project.rules ?? [] : current().globalRules;
};

const sameRule = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((part, index) => part.toLowerCase() === b[index]!.toLowerCase());

const addRule = (taskId: string, prefix: string[]): void => {
  if (!isRule(prefix)) return;
  const state = current();
  const project = sparkTaskProject(taskId);
  if (project) {
    if ((project.rules ?? []).some((rule) => sameRule(rule, prefix))) return;
    commit({ ...state, projects: state.projects.map((entry) => (entry.id === project.id ? { ...entry, rules: [...(entry.rules ?? []), prefix] } : entry)) });
    return;
  }
  if (state.globalRules.some((rule) => sameRule(rule, prefix))) return;
  commit({ ...state, globalRules: [...state.globalRules, prefix] });
};

/* ------------------------------------------------------------------------ */
/* Pending approvals                                                         */
/* ------------------------------------------------------------------------ */

export interface SparkPendingApproval {
  id: string;
  taskId: string;
  request: NativeApprovalRequest;
  createdAt: number;
}

/** Waiting approvals by task, oldest first. Sub-agents can ask at the same time as the root. */
export const sparkPendingApprovals = atom<Record<string, SparkPendingApproval[]>>({});

const approvalResolvers = new Map<string, (decision: NativeApprovalDecision) => void>();

const setPending = (taskId: string, entries: SparkPendingApproval[]): void => {
  const next = { ...sparkPendingApprovals.get() };
  if (entries.length) next[taskId] = entries;
  else delete next[taskId];
  sparkPendingApprovals.set(next);
};

/** Tells the user a task is waiting on them, as a pending question does. */
const announce = (taskId: string, request: NativeApprovalRequest): void => {
  updateSparkTask(taskId, { status: 'needs-input', hasUnreadCompletion: true });
  try {
    const api = globalThis.Notification;
    if (typeof api !== 'function' || api.permission !== 'granted') return;
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
    const task = sparkState.get().tasks.find((candidate) => candidate.id === taskId);
    // eslint-disable-next-line no-new -- the handle is not needed; the OS owns it.
    new api(task?.title || 'Spark needs your approval', {
      body: request.kind === 'command' ? `Run ${request.command}?` : 'Spark wants to edit files outside its folder.',
      tag: `spark-approval-${taskId}`,
    });
  } catch {
    // A failed alert must never take the turn down with it.
  }
};

export const resolveSparkApproval = (taskId: string, approvalId: string, decision: NativeApprovalDecision): void => {
  approvalResolvers.get(approvalId)?.(decision);
};

/**
 * Lets through every request still waiting for `taskId` that `allowed` now
 * covers. Two commands can wait together — a model may start both in one reply —
 * and approving everything, or a prefix, on the first answers the second too.
 */
const releaseAllowed = (taskId: string, allowed: (request: NativeApprovalRequest) => boolean): void => {
  for (const pending of [...(sparkPendingApprovals.get()[taskId] ?? [])]) {
    if (allowed(pending.request)) approvalResolvers.get(pending.id)?.('once');
  }
};

/** The task's `NativeApprovals`, for its native runtime. */
export const createSparkTaskApprovals = (taskId: string): NativeApprovals => ({
  mode: () => sparkTaskApprovalMode(taskId),
  rules: () => rulesFor(taskId),
  addRule: (prefix) => {
    addRule(taskId, prefix);
    releaseAllowed(taskId, (request) => request.kind === 'command' && allowedByRules(request.command ?? '', rulesFor(taskId)));
  },
  allowAll: () => {
    setSparkTaskApprovalMode(taskId, 'full');
    releaseAllowed(taskId, () => true);
  },
  request: (request, signal) => new Promise<NativeApprovalDecision>((resolve) => {
    if (signal?.aborted) {
      resolve('deny');
      return;
    }
    const entry: SparkPendingApproval = {
      id: `approval_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      taskId,
      request,
      createdAt: Date.now(),
    };
    let settled = false;
    const settle = (decision: NativeApprovalDecision) => {
      if (settled) return;
      settled = true;
      approvalResolvers.delete(entry.id);
      signal?.removeEventListener('abort', onAbort);
      const remaining = (sparkPendingApprovals.get()[taskId] ?? []).filter((pending) => pending.id !== entry.id);
      setPending(taskId, remaining);
      if (!remaining.length && !signal?.aborted) updateSparkTask(taskId, { status: 'running' });
      resolve(decision);
    };
    const onAbort = () => settle('deny');
    signal?.addEventListener('abort', onAbort, { once: true });
    approvalResolvers.set(entry.id, settle);
    setPending(taskId, [...(sparkPendingApprovals.get()[taskId] ?? []), entry]);
    announce(taskId, request);
  }),
});
