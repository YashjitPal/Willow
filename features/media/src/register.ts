/**
 * Media's contribution to the synced workspace: `Media/Tools/`, one file per tool of your own
 * (./tools/tools-disk.ts), and Media's settings in `settings.json` (./media-settings.ts). The
 * project folders beside the Tools folder are Media's own (`media-disk.ts`).
 *
 * Importing this module performs the registration. It is pulled in exactly once, from
 * apps/studio/src/app/register-features.ts.
 */
import { registerSettingsSection } from '@willow/core/settings-file';
import { registerSyncedFolder } from '@willow/storage/local-sync';
import { getMediaStorageScope, onMediaStorageScopeChange } from '@willow/storage/media-storage';
import * as mediaTools from '@willow/storage/media-tools';
import { onAgentSettingsChange, readSavedAgentSettings, writeAgentSettings } from './agent/agent-settings';
import { onModelPicksChange, readSavedModelPicks, writeModelPicks } from './media-models';
import { mediaSettingsSection, rememberedInLocalStorage } from './media-settings';
import { toolsFolderDescriptor } from './tools/tools-disk';
import { onViewSettingsChange, readSavedViewSettings, saveViewSettings } from './view-settings';

registerSyncedFolder('media-tools', toolsFolderDescriptor(mediaTools).descriptor);

registerSettingsSection('media', mediaSettingsSection({
  scope: getMediaStorageScope,
  onScopeChange: onMediaStorageScopeChange,
  agent: { read: readSavedAgentSettings, write: writeAgentSettings, subscribe: onAgentSettingsChange },
  models: { read: readSavedModelPicks, write: (scope, picks) => writeModelPicks(picks, scope), subscribe: onModelPicksChange },
  view: { read: readSavedViewSettings, write: saveViewSettings, subscribe: onViewSettingsChange },
  tools: {
    load: mediaTools.loadSavedToolPrefs,
    save: async (scope, settings) => {
      const saved = await mediaTools.loadSavedToolPrefs(scope);
      await mediaTools.saveToolPrefs({ favorites: [], pins: [], ...saved, ...settings }, scope, { fromDisk: true });
    },
    subscribe: (onChange) => mediaTools.onMediaToolsChange((change) => {
      if (change.what === 'prefs') onChange(change.scopeId);
    }),
  },
  remembered: rememberedInLocalStorage,
}));
