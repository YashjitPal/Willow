/**
 * Reading and repairing a project folder's stable id.
 *
 * A project on disk is identified by the id in its `.willow.json` manifest, not
 * by its folder name, so renaming a folder does not orphan its data. Both
 * helpers swallow their errors: a missing or unreadable manifest has to fall
 * back to name matching rather than fail the enclosing disk sync.
 */

import { readProjectManifest, writeProjectManifest } from '../adapters/local-disk';
import { readProjectRegistry } from '@willow/projects/registry';

// Resolve a project's stable id from the localStorage registry by its folder name.
export const getProjectIdByName = (projectName: string): string | null => {
  try {
    const list = readProjectRegistry() as { id: string; name: string }[];
    const found = list.find((p) => p.name === projectName);
    if (found?.id) return found.id;
  } catch {}
  return null;
};

// Ensure a project folder on disk carries a `.willow.json` manifest with its
// stable id, so it is never re-assigned a fresh random id on re-discovery.
export const ensureProjectManifest = async (projectDirHandle: FileSystemDirectoryHandle, projectName: string): Promise<void> => {
  try {
    const existing = await readProjectManifest(projectDirHandle);
    if (existing?.id) return; // already has a stable id
    const id = getProjectIdByName(projectName);
    if (id) {
      await writeProjectManifest(projectDirHandle, id);
    }
  } catch {}
};
