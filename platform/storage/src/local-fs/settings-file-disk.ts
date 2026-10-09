/**
 * `settings.json` on disk: the file `@willow/core/settings-file` keeps, at the top of the folder.
 *
 *   <chosen folder>/settings.json
 *
 * At the top rather than in a folder of its own because it is the one file a person opens to change
 * how Willow behaves, as `~/.claude/settings.json` is for Claude Code, and because it is one file:
 * a `Settings/` folder holding nothing else would be one more level to click through.
 *
 * Unlike Saved Info's reader this one throws when the file cannot be read, and answers `null` only
 * when it is not there. The store recreates a missing file, and a folder it has merely lost
 * permission to must not look like one whose file was deleted.
 */

import type { DiskDeps } from './disk-deps';

export type SettingsFileDiskDeps = Pick<DiskDeps, 'getActiveHandle'>;

export const SETTINGS_FILE = 'settings.json';

const rootOf = async ({ getActiveHandle }: SettingsFileDiskDeps): Promise<FileSystemDirectoryHandle> => {
  const root = await getActiveHandle();
  if (!root) throw new Error('The folder is not available.');
  return root;
};

export const readSettingsFile = async (
  deps: SettingsFileDiskDeps,
): Promise<{ text: string; modified: number } | null> => {
  const root = await rootOf(deps);
  let handle: FileSystemFileHandle;
  try {
    handle = await root.getFileHandle(SETTINGS_FILE);
  } catch (error) {
    if ((error as DOMException | undefined)?.name === 'NotFoundError') return null;
    throw error;
  }
  const file = await handle.getFile();
  return { text: await file.text(), modified: file.lastModified };
};

export const writeSettingsFile = async (deps: SettingsFileDiskDeps, text: string): Promise<number> => {
  const root = await rootOf(deps);
  const handle = await root.getFileHandle(SETTINGS_FILE, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
  return (await handle.getFile()).lastModified;
};
