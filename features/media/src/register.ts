/**
 * Media's contribution to the synced workspace: `Media/Tools/`, one file per tool of your own
 * (./tools/tools-disk.ts). The project folders beside it are Media's own (`media-disk.ts`).
 *
 * Importing this module performs the registration. It is pulled in exactly once, from
 * apps/studio/src/app/register-features.ts.
 */
import { registerSyncedFolder } from '@willow/storage/local-sync';
import * as mediaTools from '@willow/storage/media-tools';
import { toolsFolderDescriptor } from './tools/tools-disk';

registerSyncedFolder('media-tools', toolsFolderDescriptor(mediaTools).descriptor);
