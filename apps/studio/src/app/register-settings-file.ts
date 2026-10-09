/**
 * What goes in `settings.json`, part by part (`@willow/core/settings-file`).
 *
 * The parts every page holds from its first line register here. The ones held in React state —
 * endpoints (they reach the model setup), the model choice, and how the workspace looks — register
 * from `SettingsFileBridge` once that state exists. `order` is where each sits in the file:
 *
 *   apiKeys 10 · baseUrls 20 · model 30 · appearance 40 · labs 50 · voice 60 · rail 70 · pets 80 ·
 *   customize 85 · mcpServers 90
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
import { customizeSkills, replaceCustomizeSkills } from '../customize/customize-skills';
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
