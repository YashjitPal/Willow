/**
 * Project-area registry for the local workspace.
 *
 * A project area is a top-level workspace directory whose children are Willow
 * projects, for example `Code/<project>` or `Design/<project>`. The registry is
 * deliberately small: it describes identity and lifecycle coverage, while the
 * area-specific writers remain in their own drivers.
 *
 * Adding a new project surface should require one registration call, not edits
 * to discovery, rename, deletion, and workspace bootstrap code.
 */

/** Built-in Willow kinds plus extension kinds owned by future features. */
export type LocalProjectKind = 'code' | 'media' | 'design' | (string & {});

export interface ProjectAreaDescriptor {
  /** Stable descriptor id, normally the project kind. */
  id: string;
  /** Folder directly below the workspace root. */
  folder: string;
  /** Value written to the shared project registry. */
  kind: LocalProjectKind;
  /** Higher priority wins when two areas contain the same project name. */
  priority?: number;
  /** Create this folder when the user explicitly connects a workspace. */
  ensureOnConnect?: boolean;
}

const areas = new Map<string, ProjectAreaDescriptor>();

const validate = (descriptor: ProjectAreaDescriptor): ProjectAreaDescriptor => {
  const folder = descriptor.folder.trim();
  if (!descriptor.id.trim()) throw new Error('Project area id cannot be empty');
  if (!folder || folder.includes('\\') || folder.includes('/') || folder === '.' || folder === '..') {
    throw new Error(`Invalid project area folder: ${descriptor.folder}. Project areas must be one top-level folder name.`);
  }
  if (!descriptor.kind.trim()) throw new Error('Project area kind cannot be empty');
  return { ...descriptor, id: descriptor.id.trim(), folder, priority: descriptor.priority ?? 0 };
};

export function registerProjectArea(descriptor: ProjectAreaDescriptor): void {
  const next = validate(descriptor);
  for (const [id, existing] of areas) {
    if (id !== next.id && existing.folder.toLowerCase() === next.folder.toLowerCase()) {
      throw new Error(`Project area folder "${next.folder}" is already owned by "${id}"`);
    }
  }
  areas.set(next.id, next);
}

export function unregisterProjectArea(id: string): void {
  areas.delete(id);
}

export function getProjectAreas(): ProjectAreaDescriptor[] {
  return [...areas.values()].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id));
}

export function getProjectArea(id: string): ProjectAreaDescriptor | undefined {
  return areas.get(id);
}

/** Resolve a registered area's on-disk folder for storage drivers. */
export function getProjectAreaFolder(id: string): string {
  const area = areas.get(id);
  if (!area) throw new Error(`No local project area registered for "${id}"`);
  return area.folder;
}

/** Test seam; never call from application code. */
export function __clearProjectAreasForTest(): void {
  areas.clear();
}
