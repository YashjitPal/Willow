/**
 * The user profile on disk.
 *
 * Sits beside `saved-info.json` in the same folder and for the same reason: the
 * profile is a description of the user, assembled from their own conversations,
 * so it belongs in the folder they chose rather than in browser storage that a
 * cleared site datum wipes.
 *
 *   <chosen folder>/<workspace>/Personal/profile.json
 *
 * This one has a stronger claim to being legible than Saved Info does. Saved
 * Info is what the user typed; the profile is what a model inferred about them,
 * and the only way that is acceptable is if they can open the file and read
 * every claim with the evidence beside it. That is why the payload keeps
 * `source` and `evidence` per bullet, and why it is written indented.
 *
 * Same two rules as `saved-info-disk.ts`, for the same reasons:
 * 1. The read path never passes `{ create: true }`.
 * 2. Only a real edit or a completed build writes, because the workspace name
 *    falls back to "My Willow" until the profile loads and folders created under
 *    the fallback are junk folders the app then syncs.
 */

import type { DiskDeps } from './disk-deps';
import { PERSONAL_DIR } from './saved-info-disk';

export type ProfileDiskDeps = Pick<DiskDeps, 'getActiveHandle' | 'getSanitizedWorkspaceName'>;

export const PROFILE_FILE = 'profile.json';
export const PROFILE_DISK_VERSION = 1;

export type ProfileDiskPayload = {
  version: number;
  updatedAt: string;
  enabled: boolean;
  bullets: unknown[];
  suppressed: string[];
  lastBuiltAt?: string;
  digested: Record<string, number>;
};

/**
 * Read the profile file, or `null` when there is no folder, no permission, or
 * nothing written yet.
 *
 * The bullets come back unvalidated on purpose. `adoptProfileState` in the store
 * already narrows every field of every bullet, and duplicating that here would
 * be two validators to keep in step — one of which would eventually be the one
 * that drops a field the other kept.
 */
export const readProfileFromDisk = async (
  { getActiveHandle, getSanitizedWorkspaceName }: ProfileDiskDeps,
): Promise<Partial<ProfileDiskPayload> | null> => {
  const rootHandle = await getActiveHandle();
  if (!rootHandle) return null;

  try {
    const workspaceDir = await rootHandle.getDirectoryHandle(getSanitizedWorkspaceName());
    const personalDir = await workspaceDir.getDirectoryHandle(PERSONAL_DIR);
    const fileHandle = await personalDir.getFileHandle(PROFILE_FILE);
    const text = await (await fileHandle.getFile()).text();
    if (!text.trim()) return null;

    const parsed = JSON.parse(text) as Partial<ProfileDiskPayload>;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
};

export const writeProfileToDisk = async (
  { getActiveHandle, getSanitizedWorkspaceName }: ProfileDiskDeps,
  payload: Omit<ProfileDiskPayload, 'version' | 'updatedAt'> & { updatedAt?: string },
): Promise<boolean> => {
  const rootHandle = await getActiveHandle();
  if (!rootHandle) return false;

  try {
    const workspaceDir = await rootHandle.getDirectoryHandle(getSanitizedWorkspaceName(), { create: true });
    const personalDir = await workspaceDir.getDirectoryHandle(PERSONAL_DIR, { create: true });
    const fileHandle = await personalDir.getFileHandle(PROFILE_FILE, { create: true });

    const body: ProfileDiskPayload = {
      version: PROFILE_DISK_VERSION,
      updatedAt: payload.updatedAt ?? new Date().toISOString(),
      enabled: payload.enabled,
      bullets: payload.bullets,
      suppressed: payload.suppressed,
      ...(payload.lastBuiltAt ? { lastBuiltAt: payload.lastBuiltAt } : {}),
      digested: payload.digested,
    };

    const writable = await fileHandle.createWritable();
    await writable.write(`${JSON.stringify(body, null, 2)}\n`);
    await writable.close();
    return true;
  } catch {
    return false;
  }
};

/**
 * Delete the profile file. Used when the user clears the whole profile, so the
 * folder does not keep a copy of what they just deleted — which for this file
 * matters more than most, since the whole point of the delete was that they did
 * not want it written down.
 */
export const deleteProfileFromDisk = async (
  { getActiveHandle, getSanitizedWorkspaceName }: ProfileDiskDeps,
): Promise<boolean> => {
  const rootHandle = await getActiveHandle();
  if (!rootHandle) return false;

  try {
    const workspaceDir = await rootHandle.getDirectoryHandle(getSanitizedWorkspaceName());
    const personalDir = await workspaceDir.getDirectoryHandle(PERSONAL_DIR);
    await personalDir.removeEntry(PROFILE_FILE);
    return true;
  } catch {
    return false;
  }
};
