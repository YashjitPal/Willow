/**
 * Design storage is handled by `saveLocalFSDesignProject`, which writes
 * directly to the workspace's top-level `Design/<project>/` folder. This
 * module remains the feature's side-effect entry point for compatibility with
 * the app registration list.
 */

import { registerProjectArea } from '@willow/storage/local-sync';

registerProjectArea({ id: 'design', folder: 'Design', kind: 'design', priority: 10, ensureOnConnect: true });
