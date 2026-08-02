const DEFAULT_PROJECT_SCOPE = 'signed-out::browser::My Willow';
const LEGACY_PROJECTS_KEY = 'willow_projects_list';
const PROJECTS_KEY_PREFIX = 'willow_projects_list:v2:';
const PROJECT_TOMBSTONES_PREFIX = 'willow_project_delete_tombstones:v2:';
const PROJECT_STATE_PREFIX = 'willow_project_state:v2:';
const PROJECT_TOMBSTONE_STATE_PREFIX = 'willow_project_delete_state:v2:';
const LEGACY_PROJECTS_OWNER_KEY = 'willow_projects_list:legacy-owner:v2';
const LEGACY_CODE_SESSION_OWNER_PREFIX = 'willow_code_sessions:legacy-owner:v2:';

export const PROJECTS_UPDATED_EVENT = 'willow_projects_updated';

export interface ProjectRegistryEntry {
  id: string;
  name: string;
  [key: string]: unknown;
}

let activeProjectScopeId = DEFAULT_PROJECT_SCOPE;

const suffix = (scopeId: string): string => encodeURIComponent(scopeId || DEFAULT_PROJECT_SCOPE);

export function getProjectRegistryStorageKey(scopeId = activeProjectScopeId): string {
  return PROJECTS_KEY_PREFIX + suffix(scopeId);
}

function projectTombstonesKey(scopeId = activeProjectScopeId): string {
  return PROJECT_TOMBSTONES_PREFIX + suffix(scopeId);
}

function projectStatePrefix(scopeId = activeProjectScopeId): string {
  return `${PROJECT_STATE_PREFIX}${suffix(scopeId)}:`;
}

function projectStateKey(projectId: string, scopeId = activeProjectScopeId): string {
  return projectStatePrefix(scopeId) + encodeURIComponent(projectId);
}

function projectTombstoneStatePrefix(scopeId = activeProjectScopeId): string {
  return `${PROJECT_TOMBSTONE_STATE_PREFIX}${suffix(scopeId)}:`;
}

function projectTombstoneStateKey(projectName: string, scopeId = activeProjectScopeId): string {
  return projectTombstoneStatePrefix(scopeId) + encodeURIComponent(projectName);
}

interface ProjectDeletionState {
  deletedAt: number;
  projectId?: string;
}

function readProjectDeletion(projectName: string, scopeId = activeProjectScopeId): ProjectDeletionState | null {
  const raw = localStorage.getItem(projectTombstoneStateKey(projectName, scopeId));
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.deletedAt === 'number') return parsed;
    } catch {
      const deletedAt = Number(raw);
      if (Number.isFinite(deletedAt)) return { deletedAt };
    }
    return { deletedAt: Date.now() };
  }
  const legacyDeletedAt = readTombstones(scopeId)[projectName];
  return typeof legacyDeletedAt === 'number' ? { deletedAt: legacyDeletedAt } : null;
}

function clearProjectDeletion(projectName: string, scopeId = activeProjectScopeId): void {
  localStorage.removeItem(projectTombstoneStateKey(projectName, scopeId));
  const legacy = readTombstones(scopeId);
  if (Object.prototype.hasOwnProperty.call(legacy, projectName)) {
    delete legacy[projectName];
    localStorage.setItem(projectTombstonesKey(scopeId), JSON.stringify(legacy));
  }
}

function parseRegistry(raw: string | null): ProjectRegistryEntry[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is ProjectRegistryEntry =>
      !!entry && typeof entry === 'object' &&
      typeof entry.id === 'string' && entry.id.length > 0 &&
      typeof entry.name === 'string' && entry.name.length > 0
    );
  } catch {
    return [];
  }
}

function readTombstones(scopeId = activeProjectScopeId): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(projectTombstonesKey(scopeId)) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, number> = {};
    for (const [name, timestamp] of Object.entries(parsed)) {
      if (name && typeof timestamp === 'number' && Number.isFinite(timestamp)) result[name] = timestamp;
    }
    return result;
  } catch {
    return {};
  }
}

function migrateLegacyRegistry(scopeId: string): void {
  if (typeof window === 'undefined' || scopeId.startsWith('signed-out::')) return;
  const scopedKey = getProjectRegistryStorageKey(scopeId);
  if (localStorage.getItem(scopedKey) !== null) return;
  const legacyRaw = localStorage.getItem(LEGACY_PROJECTS_KEY);
  if (legacyRaw === null) return;

  // The old registry carried no owner. Claim it before copying, then verify the
  // claim so two accounts/tabs cannot both adopt the same global list.
  const existingOwner = localStorage.getItem(LEGACY_PROJECTS_OWNER_KEY);
  if (existingOwner && existingOwner !== scopeId) return;
  if (!existingOwner) localStorage.setItem(LEGACY_PROJECTS_OWNER_KEY, scopeId);
  if (localStorage.getItem(LEGACY_PROJECTS_OWNER_KEY) !== scopeId) return;

  localStorage.setItem(scopedKey, JSON.stringify(parseRegistry(legacyRaw)));
  // Remove only after the scoped copy is durable. The owner marker remains so
  // an old tab cannot later recreate and re-adopt the global key elsewhere.
  localStorage.removeItem(LEGACY_PROJECTS_KEY);
}

export function setProjectStorageScope(scopeId: string): void {
  const nextScopeId = scopeId || DEFAULT_PROJECT_SCOPE;
  migrateLegacyRegistry(nextScopeId);
  if (activeProjectScopeId === nextScopeId) return;
  activeProjectScopeId = nextScopeId;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PROJECTS_UPDATED_EVENT, { detail: { scopeId: nextScopeId } }));
  }
}

export function getProjectStorageScope(): string {
  return activeProjectScopeId;
}

export function isActiveProjectRegistryStorageKey(key: string | null): boolean {
  return key === getProjectRegistryStorageKey() ||
    !!key?.startsWith(projectStatePrefix()) ||
    !!key?.startsWith(projectTombstoneStatePrefix());
}

export function readProjectRegistry(scopeId = activeProjectScopeId): ProjectRegistryEntry[] {
  if (typeof window === 'undefined') return [];
  migrateLegacyRegistry(scopeId);
  const byId = new Map(parseRegistry(localStorage.getItem(getProjectRegistryStorageKey(scopeId))).map((project) => [project.id, project]));
  const prefix = projectStatePrefix(scopeId);
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix)) continue;
    try {
      const projectId = decodeURIComponent(key.slice(prefix.length));
      const state = JSON.parse(localStorage.getItem(key) || '{}') as { project?: ProjectRegistryEntry | null };
      if (state.project && state.project.id === projectId) byId.set(projectId, state.project);
      else if (state.project === null) byId.delete(projectId);
    } catch {}
  }
  return [...byId.values()];
}

export function writeProjectRegistry(projects: ProjectRegistryEntry[], scopeId = activeProjectScopeId): void {
  if (typeof window === 'undefined') return;
  const previous = readProjectRegistry(scopeId);
  const next = parseRegistry(JSON.stringify(projects)).filter((project) => {
    const deletion = readProjectDeletion(project.name, scopeId);
    if (!deletion) return true;
    // Project IDs are freshly minted for a real recreation. A stale tab still
    // carries the deleted ID, so it remains blocked and cannot resurrect the
    // folder; a new ID is the explicit signal to release the name tombstone.
    if (deletion.projectId && deletion.projectId !== project.id) {
      clearProjectDeletion(project.name, scopeId);
      return true;
    }
    return false;
  });
  const requestedIds = new Set(next.map((project) => project.id));
  // A caller often writes a full list captured during an earlier render. Keep
  // canonical projects it never saw unless a scoped delete tombstone proves
  // the omission is intentional; this prevents a star/rename in tab A from
  // deleting a browser-only project concurrently added in tab B.
  for (const project of previous) {
    if (!requestedIds.has(project.id) && !isProjectSaveBlocked(project.name, scopeId)) {
      next.push(project);
    }
  }
  const previousNames = new Set(previous.map((project) => project.name));
  const nextNames = new Set(next.map((project) => project.name));
  const now = Date.now();

  // Per-project records are canonical. Concurrent tabs changing different
  // projects write different keys, so replacing the compatibility snapshot
  // cannot erase the other tab's mutation.
  const previousById = new Map(previous.map((project) => [project.id, project]));
  const nextById = new Map(next.map((project) => [project.id, project]));
  for (const projectId of new Set([...previousById.keys(), ...nextById.keys()])) {
    const before = previousById.get(projectId);
    const after = nextById.get(projectId);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    localStorage.setItem(projectStateKey(projectId, scopeId), JSON.stringify({
      project: after ?? null,
      updatedAt: now,
      mutationId: crypto.randomUUID?.() || `${now}_${Math.random().toString(36).slice(2)}`,
    }));
  }

  for (const name of previousNames) {
    if (!nextNames.has(name) && !readProjectDeletion(name, scopeId)) {
      const deletedProject = previous.find((project) => project.name === name);
      markProjectDeleted(name, scopeId, deletedProject?.id);
    }
  }
  localStorage.setItem(getProjectRegistryStorageKey(scopeId), JSON.stringify(next));
}

export function markProjectDeleted(projectName: string, scopeId = activeProjectScopeId, projectId?: string): void {
  if (!projectName || typeof window === 'undefined') return;
  localStorage.setItem(projectTombstoneStateKey(projectName, scopeId), JSON.stringify({
    deletedAt: Date.now(),
    ...(projectId ? { projectId } : {}),
  } satisfies ProjectDeletionState));
}

export function isProjectSaveBlocked(projectName: string, scopeId = activeProjectScopeId): boolean {
  if (!projectName || typeof window === 'undefined') return false;
  return readProjectDeletion(projectName, scopeId) !== null;
}

export function ownsLegacyProjectRegistry(scopeId = activeProjectScopeId): boolean {
  return !!scopeId && !scopeId.startsWith('signed-out::') &&
    localStorage.getItem(LEGACY_PROJECTS_OWNER_KEY) === scopeId;
}

export function canAdoptLegacyCodeSession(logicalStorageKey: string, scopeId = activeProjectScopeId): boolean {
  if (!logicalStorageKey || !ownsLegacyProjectRegistry(scopeId)) return false;
  if (logicalStorageKey === 'willow_chat_sessions_default') return true;
  const prefix = 'willow_chat_sessions_';
  if (!logicalStorageKey.startsWith(prefix)) return false;
  const projectName = logicalStorageKey.slice(prefix.length);
  return readProjectRegistry(scopeId).some((project) => project.name === projectName);
}

export function claimLegacyCodeSession(
  logicalStorageKey: string,
  scopeId = activeProjectScopeId,
  verifiedForScope = false,
): boolean {
  if ((!verifiedForScope && !canAdoptLegacyCodeSession(logicalStorageKey, scopeId)) ||
      (verifiedForScope && !ownsLegacyProjectRegistry(scopeId))) return false;
  const ownerKey = LEGACY_CODE_SESSION_OWNER_PREFIX + encodeURIComponent(logicalStorageKey);
  const existingOwner = localStorage.getItem(ownerKey);
  if (existingOwner && existingOwner !== scopeId) return false;
  if (!existingOwner) localStorage.setItem(ownerKey, scopeId);
  return localStorage.getItem(ownerKey) === scopeId;
}
