import type { ProjectRegistryEntry } from './projectStorage';

export interface DriveProjectFolder {
  id: string;
  name: string;
}

export interface DriveProjectRegistryEntry extends ProjectRegistryEntry {
  kind?: 'code' | 'media';
  driveFolderId?: string;
  onDrive?: boolean;
}

/**
 * Merge visible Drive project folders into the local registry without treating
 * a transient/partial Drive listing as a deletion signal.
 */
export function mergeDriveProjectsIntoRegistry(
  registry: DriveProjectRegistryEntry[],
  folders: DriveProjectFolder[],
  isBlocked: (projectName: string) => boolean = () => false,
): { projects: DriveProjectRegistryEntry[]; changed: boolean } {
  const projects = registry.map((project) => ({ ...project }));
  const usedIds = new Set(projects.map((project) => project.id));
  let changed = false;

  for (const folder of folders) {
    if (!folder?.id || !folder?.name) continue;
    if (isBlocked(folder.name)) continue;
    let index = projects.findIndex((project) => project.driveFolderId === folder.id);
    if (index < 0) {
      index = projects.findIndex((project) =>
        project.kind !== 'media' && project.name.toLocaleLowerCase() === folder.name.toLocaleLowerCase()
      );
    }
    if (index >= 0) {
      const current = projects[index];
      const next = { ...current, driveFolderId: folder.id, onDrive: true, kind: current.kind || 'code' as const };
      if (JSON.stringify(current) !== JSON.stringify(next)) {
        projects[index] = next;
        changed = true;
      }
      continue;
    }

    let id = `drive_${folder.id}`;
    let suffix = 2;
    while (usedIds.has(id)) id = `drive_${folder.id}_${suffix++}`;
    usedIds.add(id);
    projects.push({ id, name: folder.name, kind: 'code', driveFolderId: folder.id, onDrive: true });
    changed = true;
  }

  return { projects, changed };
}
