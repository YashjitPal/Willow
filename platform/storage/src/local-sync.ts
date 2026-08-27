/**
 * Public local-sync facade.
 *
 * Import this module when building a feature that needs Willow-style local
 * persistence. It intentionally exposes the registration contracts without
 * exposing LocalFSContext's React implementation details.
 */

export {
  registerSyncedFolder,
  unregisterSyncedFolder,
  getSyncedFolders,
  type SyncedFolderDescriptor,
  type SyncedFolderContext,
  type SyncedItem,
} from './synced-folders';

export {
  registerProjectFolderWriter,
  unregisterProjectFolderWriter,
  getProjectFolderWriters,
  type ProjectFolderWriter,
  type ProjectFolderWriteContext,
} from './project-contributors';

export {
  registerProjectArea,
  unregisterProjectArea,
  getProjectAreas,
  getProjectArea,
  getProjectAreaFolder,
  type ProjectAreaDescriptor,
  type LocalProjectKind,
} from './local-fs/project-areas';

export {
  reconcileFolder,
  isValidItemId,
  type DiskEntry,
  type FolderSyncPorts,
  type ReconcileResult,
} from './local-fs/folder-sync-engine';

export { syncRegisteredFolder, syncedFolderKeys } from './local-fs/synced-folder-driver';
