/**
 * What goes in `settings.json`, part by part (`@willow/core/settings-file`).
 *
 * The parts every page holds from its first line register here. The ones held in React state —
 * endpoints (they reach the model setup), the model choice, and how the workspace looks — register
 * from `SettingsFileBridge` once that state exists. `order` is where each sits in the file:
 *
 *   apiKeys 10 · baseUrls 20 · providers 25 · model 30 · appearance 40 · labs 50 · voice 60 · rail 70 ·
 *   projects 72 (`project-stars.ts`) · pinnedChats 75 (`PinnedChatsSettingsSection`) · spark 78 · pages 79 · pets 80 ·
 *   companion 82 · customize 85 · gems 87 · connectors 88 · mcpServers 90
 *
 * Every `apply` narrows what it is given: the file is the user's to edit, and a wrong value in it
 * must leave the setting as it was rather than reach the store.
 */

import { registerSettingsSection } from '@willow/core/settings-file';
import { EXPERIMENT_DEFAULTS, experimentsStore, setExperiment, type ExperimentId } from '@willow/core/experiments-store';
import { DEVICE_KEY_SLOT } from '@willow/auth/device-keys';
import { mcpServers, replaceMcpServers, type McpServerConfig } from '@willow/ai/mcp/mcp-store';
import type { McpOAuthGrant } from '@willow/ai/mcp/mcp-oauth';
import { liveModelStore, setLiveModelId } from '@willow/chat/voice-settings/live-model-store';
import { replaceVoiceSettings, voiceSettingsStore } from '@willow/chat/voice-settings/voice-settings-store';
import {
  choosePet,
  petDetails,
  petSelection,
  petSettings,
  replacePetDetails,
  updatePetSettings,
  type PetSettings,
} from '@willow/spark/pets/pet-store';
import { clientIdProblem, setUserClientId, userClientIds, type ClientIdProvider } from '@willow/personal/connectors/client-ids';
import { connectorOptions, setGmailContentsAllowed } from '@willow/personal/connectors/connector-options';
import { replaceSparkApps, setSparkUltraEngaged, sparkHydrationScope, sparkState, sparkUltraEngaged } from '@willow/spark/spark-store';
import { readSparkProjects, replaceSparkProjects, sparkProjects } from '@willow/spark/spark-projects';
import { PAGES_FONT_SIZE_BOUNDS, usePagesViewSettingsStore } from '@willow/spark/codex/lib/pages-view-settings';
import { gemChatIndexStore, replaceGemChatIndex } from '@willow/gems/gems-store';
import { projectStarsSection } from './project-stars';
import { customizeSkills, replaceCustomizeSkills } from '../customize/customize-skills';
import {
  activeModelStore,
  activePersonaStore,
  companionModelFor,
  companionPersonaFor,
  replaceWaifuSettings,
  setActiveModel,
  setActivePersona,
  waifuSettingsStore,
} from '../waifu/waifu-store';
import { WAIFU_MODELS } from '../waifu/waifu-models';
import { $railCustomization, parseRailCustomization, saveRailCustomization } from '../shell/rail/rail-pins';
import { PROVIDER_IDS, applyProviderValues, readDeviceProviderState } from '../settings/provider-settings';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The keys change in this tab (Models & API, or the file) and in others (`storage`). */
export const subscribeProviderValues = (onChange: () => void): (() => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key === DEVICE_KEY_SLOT.providerState || event.key === DEVICE_KEY_SLOT.apiKeys) onChange();
  };
  window.addEventListener('apikeys-updated', onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('apikeys-updated', onChange);
    window.removeEventListener('storage', onStorage);
  };
};

/*
 * One field per provider, as the Models & API page has it: several keys separated by commas or
 * new lines, as typed. Meeting a folder's file for the first time, a key only this copy has is
 * kept — the file is where keys go not to be lost, so it must not be what loses one.
 */
registerSettingsSection('apiKeys', {
  order: 10,
  read: () => {
    const state = readDeviceProviderState();
    return Object.fromEntries(PROVIDER_IDS.map((provider) => [provider, state[provider].apiKey]));
  },
  apply: (value) => {
    if (!isObject(value)) return;
    applyProviderValues(Object.fromEntries(PROVIDER_IDS
      .filter((provider) => typeof value[provider] === 'string')
      .map((provider) => [provider, { apiKey: value[provider] as string }])));
  },
  subscribe: subscribeProviderValues,
  merge: (fromFile, local) => {
    const file = isObject(fromFile) ? fromFile : {};
    const mine = isObject(local) ? local : {};
    return Object.fromEntries(PROVIDER_IDS.map((provider) => {
      const fileKey = typeof file[provider] === 'string' ? file[provider] as string : '';
      const localKey = typeof mine[provider] === 'string' ? mine[provider] as string : '';
      return [provider, fileKey.trim() ? fileKey : localKey];
    }));
  },
});

registerSettingsSection('labs', {
  order: 50,
  read: () => ({ ...experimentsStore.get() }),
  apply: (value) => {
    if (!isObject(value)) return;
    const current = experimentsStore.get();
    for (const id of Object.keys(EXPERIMENT_DEFAULTS) as ExperimentId[]) {
      if (typeof value[id] === 'boolean' && value[id] !== current[id]) setExperiment(id, value[id] as boolean);
    }
  },
  subscribe: (onChange) => experimentsStore.listen(onChange),
});

registerSettingsSection('voice', {
  order: 60,
  read: () => ({ liveModel: liveModelStore.get(), voices: voiceSettingsStore.get() }),
  apply: (value) => {
    if (!isObject(value)) return;
    if (typeof value.liveModel === 'string' && value.liveModel !== liveModelStore.get()) setLiveModelId(value.liveModel);
    if ('voices' in value && !same(value.voices, voiceSettingsStore.get())) replaceVoiceSettings(value.voices);
  },
  subscribe: (onChange) => {
    const stops = [liveModelStore.listen(onChange), voiceSettingsStore.listen(onChange)];
    return () => stops.forEach((stop) => stop());
  },
});

registerSettingsSection('rail', {
  order: 70,
  read: () => $railCustomization.get(),
  apply: (value) => saveRailCustomization(parseRailCustomization(value)),
  subscribe: (onChange) => $railCustomization.listen(onChange),
});

registerSettingsSection('projects', projectStarsSection);

const records = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isObject) : []);

const sparkFolders = () => {
  const { projects, globalRules, taskModes, taskProjects } = readSparkProjects();
  return { projects, globalRules, taskModes, taskProjects };
};

/*
 * Spark: Ultra, the apps it may use, and in the desktop app the folders its tasks work in, with what
 * each may do without asking. The apps are part of Spark's saved workspace, read for the signed-in
 * account after startup, so the section joins once it is: the file is never answered with the apps
 * Spark starts with. A folder is a path on one computer; one from another computer's file is listed
 * and simply isn't there.
 */
const sparkSection = {
  order: 78,
  read: () => {
    const { connections, customApps } = sparkState.get();
    return { ultra: sparkUltraEngaged.get(), connections, customApps, folders: sparkFolders() };
  },
  apply: (value: unknown) => {
    if (!isObject(value)) return;
    if (typeof value.ultra === 'boolean' && value.ultra !== sparkUltraEngaged.get()) setSparkUltraEngaged(value.ultra);
    replaceSparkApps({ connections: value.connections, customApps: value.customApps });
    if (isObject(value.folders)) replaceSparkProjects({ ...readSparkProjects(), ...value.folders });
  },
  subscribe: (onChange: () => void) => {
    let { connections, customApps } = sparkState.get();
    const stops = [
      sparkState.listen((state) => {
        if (state.connections === connections && state.customApps === customApps) return;
        ({ connections, customApps } = state);
        onChange();
      }),
      sparkUltraEngaged.listen(onChange),
      sparkProjects.listen(onChange),
    ];
    return () => stops.forEach((stop) => stop());
  },
  // Meeting a folder's file for the first time, custom apps and folders only this copy has are kept.
  merge: (fromFile: unknown, local: unknown) => {
    const file = isObject(fromFile) ? fromFile : {};
    const mine = isObject(local) ? local : {};
    const fileApps = records(file.customApps);
    const fileFolders = isObject(file.folders) ? file.folders : {};
    const myFolders = isObject(mine.folders) ? mine.folders : {};
    const fileProjects = records(fileFolders.projects);
    return {
      ...mine,
      ...file,
      customApps: [...fileApps, ...records(mine.customApps).filter((app) => !fileApps.some((entry) => entry.id === app.id))],
      folders: {
        ...myFolders,
        ...fileFolders,
        projects: [
          ...fileProjects,
          ...records(myFolders.projects).filter((project) => !fileProjects.some((entry) => entry.id === project.id || entry.path === project.path)),
        ],
      },
    };
  },
};
sparkHydrationScope.subscribe((scope) => {
  if (scope) registerSettingsSection('spark', sparkSection);
});

/* Spark → Pages, as Codex's Settings → Appearance → Pages has it: text size, full width, smart punctuation. */
registerSettingsSection('pages', {
  order: 79,
  read: () => {
    const { fontSize, fullWidth, smartPunctuationEnabled } = usePagesViewSettingsStore.getState();
    return { fontSize, fullWidth, smartPunctuationEnabled };
  },
  apply: (value) => {
    if (!isObject(value)) return;
    const view = usePagesViewSettingsStore.getState();
    if (typeof value.fontSize === 'number' && Number.isFinite(value.fontSize)) {
      const fontSize = Math.min(PAGES_FONT_SIZE_BOUNDS.max, Math.max(PAGES_FONT_SIZE_BOUNDS.min, Math.round(value.fontSize)));
      if (fontSize !== view.fontSize) view.setPagesViewSetting('fontSize', fontSize);
    }
    if (typeof value.fullWidth === 'boolean' && value.fullWidth !== view.fullWidth) view.setPagesViewSetting('fullWidth', value.fullWidth);
    if (typeof value.smartPunctuationEnabled === 'boolean' && value.smartPunctuationEnabled !== view.smartPunctuationEnabled) {
      view.setPagesViewSetting('smartPunctuationEnabled', value.smartPunctuationEnabled);
    }
  },
  subscribe: (onChange) => usePagesViewSettingsStore.subscribe(onChange),
});

registerSettingsSection('pets', {
  order: 80,
  read: () => ({ selected: petSelection.get(), settings: petSettings.get(), names: petDetails.get() }),
  apply: (value) => {
    if (!isObject(value)) return;
    // Settings first: a sheet of one's own chooses Rocky, and the file's own choice comes after.
    if (isObject(value.settings) && !same(value.settings, petSettings.get())) updatePetSettings(value.settings as Partial<PetSettings>);
    if ('selected' in value && value.selected !== petSelection.get()) choosePet(value.selected);
    if ('names' in value && !same(value.names, petDetails.get())) replacePetDetails(value.names);
  },
  subscribe: (onChange) => {
    const stops = [petSettings.store.listen(onChange), petSelection.store.listen(onChange), petDetails.store.listen(onChange)];
    return () => stops.forEach((stop) => stop());
  },
});

// The Labs companion: its avatar (one loaded from its own URL in full), persona, voice and look. Its
// conversation is `Labs/Companion/history.json`.
registerSettingsSection('companion', {
  order: 82,
  read: () => {
    const avatar = activeModelStore.get();
    const custom = !WAIFU_MODELS.some((model) => model.id === avatar.id);
    return {
      avatar: avatar.id,
      ...(custom ? { customAvatar: avatar } : {}),
      persona: activePersonaStore.get().id,
      settings: waifuSettingsStore.get(),
    };
  },
  apply: (value) => {
    if (!isObject(value)) return;
    const avatar = companionModelFor(value.avatar, value.customAvatar);
    if (avatar && !same(avatar, activeModelStore.get())) setActiveModel(avatar);
    const persona = companionPersonaFor(value.persona);
    if (persona && persona.id !== activePersonaStore.get().id) setActivePersona(persona);
    if ('settings' in value) replaceWaifuSettings(value.settings);
  },
  subscribe: (onChange) => {
    const stops = [activeModelStore.listen(onChange), activePersonaStore.listen(onChange), waifuSettingsStore.listen(onChange)];
    return () => stops.forEach((stop) => stop());
  },
});

const CLIENT_ID_PROVIDERS: readonly ClientIdProvider[] = ['google', 'spotify'];

/*
 * Settings → Connected Apps: the OAuth client ids the user made for Willow (public by design, they're
 * in every consent URL) and what Gmail may read. Which products are connected stays in this browser
 * (`connections-store.ts`): the tokens behind them don't travel, so the file mustn't claim they do.
 * Meeting a folder's file for the first time, a client id only this copy has is kept.
 */
registerSettingsSection('connectors', {
  order: 88,
  read: () => ({ clientIds: { ...userClientIds.get() }, gmailContents: connectorOptions.get().gmailContents === true }),
  apply: (value) => {
    if (!isObject(value)) return;
    if (isObject(value.clientIds)) {
      for (const provider of CLIENT_ID_PROVIDERS) {
        const given = value.clientIds[provider];
        const current = userClientIds.get()[provider];
        if (given === undefined || given === null || given === '') {
          if (current) setUserClientId(provider, null);
        } else if (typeof given === 'string' && !clientIdProblem(provider, given) && given.trim() !== current) {
          setUserClientId(provider, given);
        }
      }
    }
    if (typeof value.gmailContents === 'boolean' && value.gmailContents !== (connectorOptions.get().gmailContents === true)) {
      setGmailContentsAllowed(value.gmailContents);
    }
  },
  subscribe: (onChange) => {
    const stops = [userClientIds.listen(onChange), connectorOptions.listen(onChange)];
    return () => stops.forEach((stop) => stop());
  },
  merge: (fromFile, local) => {
    const file = isObject(fromFile) ? fromFile : {};
    const mine = isObject(local) ? local : {};
    return { ...file, clientIds: { ...(isObject(mine.clientIds) ? mine.clientIds : {}), ...(isObject(file.clientIds) ? file.clientIds : {}) } };
  },
});

/* Customize → Skills: which are on, the edits made to any, and the ones made or uploaded there. */
registerSettingsSection('customize', {
  order: 85,
  read: () => ({ skills: customizeSkills.get() }),
  apply: (value) => {
    if (isObject(value) && 'skills' in value && !same(value.skills, customizeSkills.get())) replaceCustomizeSkills(value.skills);
  },
  subscribe: (onChange) => customizeSkills.listen(onChange),
});

const textMap = (value: unknown): Record<string, string> | undefined =>
  isObject(value) ? Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry === 'string')) as Record<string, string> : undefined;

/** A sign-in's tokens as the store keeps them, or nothing when any part it needs is missing. */
const toGrant = (value: unknown): McpOAuthGrant | undefined => {
  if (!isObject(value)) return undefined;
  const { accessToken, tokenEndpoint, resource, clientId, refreshToken, expiresAt, scope, clientSecret } = value;
  if (typeof accessToken !== 'string' || typeof tokenEndpoint !== 'string' || typeof resource !== 'string' || typeof clientId !== 'string') return undefined;
  return {
    accessToken,
    tokenEndpoint,
    resource,
    clientId,
    ...(typeof refreshToken === 'string' ? { refreshToken } : {}),
    ...(typeof expiresAt === 'number' ? { expiresAt } : {}),
    ...(typeof scope === 'string' ? { scope } : {}),
    ...(typeof clientSecret === 'string' ? { clientSecret } : {}),
  };
};

const toMcpServer = (value: unknown): McpServerConfig[] => {
  if (!isObject(value) || typeof value.id !== 'string' || !value.id.trim() || typeof value.label !== 'string') return [];
  if (value.kind !== 'http' && value.kind !== 'worker' && value.kind !== 'program') return [];
  const headers = textMap(value.headers);
  const env = textMap(value.env);
  const oauth = toGrant(value.oauth);
  return [{
    id: value.id,
    label: value.label,
    kind: value.kind,
    ...(typeof value.url === 'string' ? { url: value.url } : {}),
    ...(headers ? { headers } : {}),
    ...(oauth ? { oauth } : {}),
    ...(typeof value.script === 'string' ? { script: value.script } : {}),
    ...(typeof value.command === 'string' ? { command: value.command } : {}),
    ...(Array.isArray(value.args) ? { args: value.args.filter((arg): arg is string => typeof arg === 'string') } : {}),
    ...(env ? { env } : {}),
    ...(typeof value.cwd === 'string' ? { cwd: value.cwd } : {}),
    // Off unless the file says on, as a server added on the page is.
    enabled: value.enabled === true,
  }];
};

/*
 * Which Gem each chat was started with, by chat id (a chat file has no Gem field), so a Gem chat
 * reopened after a reinstall is still that Gem's. Meeting a folder's file, both copies' links are kept.
 */
registerSettingsSection('gems', {
  order: 87,
  read: () => ({ chats: gemChatIndexStore.get() }),
  apply: (value) => {
    if (isObject(value) && isObject(value.chats)) replaceGemChatIndex(value.chats);
  },
  subscribe: (onChange) => gemChatIndexStore.listen(onChange),
  merge: (fromFile, local) => {
    const chats = (value: unknown) => (isObject(value) && isObject(value.chats) ? value.chats : {});
    return { chats: { ...chats(local), ...chats(fromFile) } };
  },
});

/* Meeting a folder's file for the first time, servers only this copy has are kept beside the file's. */
registerSettingsSection('mcpServers', {
  order: 90,
  read: () => mcpServers.get(),
  apply: (value) => {
    if (!Array.isArray(value)) return;
    void replaceMcpServers(value.flatMap(toMcpServer));
  },
  subscribe: (onChange) => mcpServers.listen(onChange),
  merge: (fromFile, local) => {
    const file = Array.isArray(fromFile) ? fromFile.flatMap(toMcpServer) : [];
    const mine = Array.isArray(local) ? local.flatMap(toMcpServer) : [];
    return [...file, ...mine.filter((server) => !file.some((entry) => entry.id === server.id))];
  },
});
