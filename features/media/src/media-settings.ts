/**
 * Media's settings in `settings.json`, under `media`, so a new copy of Willow on the folder starts
 * with them:
 *
 *   "media": {
 *     "agent":  { "confirmBeforeGenerating": false, "instructions": [ … ] },
 *     "models": { "image": "…", "video": "…", "music": "…" },
 *     "view":   { "viewMode": "grid", "gridSize": "M", … },
 *     "tools":  { "favorites": [ … ], "pins": [ … ], "recent": [ … ] }
 *   }
 *
 * Each part stays in the store that owns it (./agent/agent-settings.ts, ./media-models.ts,
 * ./view-settings.ts, the Tools preferences in IndexedDB); ./register.ts hands them to this section.
 *
 * The agent's settings and the model picks belong to the account, and the Tools preferences to the
 * account and folder, so signing in moves them to a scope that may have none yet. A part the scope has
 * none of is taken from the file's, as this browser last saw it (remembered per folder), rather than
 * written out as nothing: a new scope is not one emptied.
 */

import type { SettingsSection } from '@willow/core/settings-file';
import type { StoredToolPrefs } from '@willow/storage/media-tools';
import { narrowAgentSettings, type AgentSettings } from './agent/agent-settings';
import { narrowModelPicks, type ModelPicks } from './media-models';
import { narrowViewSettings, type ViewSettings } from './view-settings';

export interface ToolPrefsSettings {
  favorites: string[];
  pins: string[];
  recent?: string[];
}

export interface MediaSettings {
  agent?: AgentSettings;
  models?: ModelPicks;
  view?: ViewSettings;
  tools?: ToolPrefsSettings;
}

/** As many recent tools as the Tools store keeps. */
const MAX_RECENT_TOOLS = 20;

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const ids = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))] : undefined;

export function narrowToolSettings(raw: unknown): ToolPrefsSettings | null {
  if (!isObject(raw)) return null;
  const favorites = ids(raw.favorites);
  const pins = ids(raw.pins);
  const recent = ids(raw.recent);
  if (!favorites && !pins && !recent) return null;
  return { favorites: favorites ?? [], pins: pins ?? [], ...(recent ? { recent: recent.slice(0, MAX_RECENT_TOOLS) } : {}) };
}

/** The section's value from the file, which is the user's to edit: each part narrowed, and left out when it isn't one. */
export function narrowMediaSettings(raw: unknown): MediaSettings {
  if (!isObject(raw)) return {};
  const out: MediaSettings = {};
  const agent = narrowAgentSettings(raw.agent);
  if (agent) out.agent = agent;
  const models = narrowModelPicks(raw.models);
  if (models && Object.keys(models).length) out.models = models;
  const view = narrowViewSettings(raw.view);
  if (view) out.view = view;
  const tools = narrowToolSettings(raw.tools);
  if (tools) out.tools = tools;
  return out;
}

const union = (first: readonly string[] = [], second: readonly string[] = []): string[] =>
  [...first, ...second.filter((id) => !first.includes(id))];

/** The first time this browser meets the folder's file: the file's values, with what only this browser has added. */
export function mergeMediaSettings(file: MediaSettings, local: MediaSettings): MediaSettings {
  const out: MediaSettings = { ...local, ...file };
  if (file.agent && local.agent) {
    const inFile = new Set(file.agent.instructions.map((instruction) => instruction.id));
    out.agent = {
      ...file.agent,
      instructions: [...file.agent.instructions, ...local.agent.instructions.filter((instruction) => !inFile.has(instruction.id))],
    };
  }
  if (file.models && local.models) out.models = { ...local.models, ...file.models };
  if (file.tools && local.tools) {
    const recent = file.tools.recent || local.tools.recent
      ? union(file.tools.recent, local.tools.recent).slice(0, MAX_RECENT_TOOLS)
      : undefined;
    out.tools = {
      favorites: union(file.tools.favorites, local.tools.favorites),
      pins: union(file.tools.pins, local.tools.pins),
      ...(recent ? { recent } : {}),
    };
  }
  return out;
}

const toolSettingsOf = (prefs: StoredToolPrefs): ToolPrefsSettings => ({
  favorites: [...prefs.favorites],
  pins: [...prefs.pins],
  ...(prefs.recent ? { recent: [...prefs.recent] } : {}),
});

/** Where each part lives. Reads answer null for a scope that never saved the part. */
export interface MediaSettingsStores {
  /** The scope media is kept under now (`${uid}::${rootId}`). */
  scope(): string;
  onScopeChange(listener: (next: string, previous: string) => void): () => void;
  agent: { read(scope: string): AgentSettings | null; write(scope: string, settings: AgentSettings): void; subscribe(onChange: () => void): () => void };
  models: { read(scope: string): ModelPicks | null; write(scope: string, picks: ModelPicks): void; subscribe(onChange: () => void): () => void };
  view: { read(): ViewSettings | null; write(settings: ViewSettings): void; subscribe(onChange: () => void): () => void };
  /** `save` keeps the preferences the file does not hold (the dock's state, the panel's width). */
  tools: {
    load(scope: string): Promise<StoredToolPrefs | null>;
    save(scope: string, settings: ToolPrefsSettings): Promise<void>;
    subscribe(onChange: (scope: string) => void): () => void;
  };
  /** The section's value as the folder's file last had it, kept per folder. */
  remembered: { read(folder: string): unknown; write(folder: string, value: MediaSettings): void };
}

/** The folder part of a scope; `browser` is the scope of no folder, which has no file. */
const folderOf = (scope: string): string | null => {
  const folder = scope.split('::').slice(1).join('::');
  return folder && folder !== 'browser' ? folder : null;
};

export function mediaSettingsSection(stores: MediaSettingsStores): SettingsSection {
  // IndexedDB can't answer `read()` as it is asked, so the scope's Tools preferences are read ahead;
  // until they are, the section leaves the file's value as it is.
  let tools: { scope: string; prefs: StoredToolPrefs | null } | null = null;
  let loads = 0;
  let changed: () => void = () => {};
  /** What `merge` last answered, so `apply` knows the value it is given is a merge's. */
  let merged: MediaSettings | null = null;

  const fileParts = (scope: string): MediaSettings => {
    const folder = folderOf(scope);
    return folder ? narrowMediaSettings(stores.remembered.read(folder)) : {};
  };
  const remember = (scope: string, value: MediaSettings): void => {
    const folder = folderOf(scope);
    if (folder) stores.remembered.write(folder, value);
  };
  /** What the scope's own stores hold, and its Tools preferences once read. */
  const ownParts = (scope: string): MediaSettings => {
    const value: MediaSettings = {};
    const agent = stores.agent.read(scope);
    if (agent) value.agent = agent;
    const models = stores.models.read(scope);
    if (models && Object.keys(models).length) value.models = models;
    const view = stores.view.read();
    if (view) value.view = view;
    if (tools?.scope === scope && tools.prefs) value.tools = toolSettingsOf(tools.prefs);
    return value;
  };

  /** Each part the scope has none of, from the file: what a scope new to the folder starts from. */
  const adoptFileParts = (scope: string, prefs: StoredToolPrefs | null): StoredToolPrefs | null => {
    const file = fileParts(scope);
    if (file.agent && !stores.agent.read(scope)) stores.agent.write(scope, file.agent);
    if (file.models && !stores.models.read(scope)) stores.models.write(scope, file.models);
    if (file.view && !stores.view.read()) stores.view.write(file.view);
    if (prefs || !file.tools) return prefs;
    void stores.tools.save(scope, file.tools).catch(() => undefined);
    return { favorites: [], pins: [], ...file.tools };
  };

  const loadTools = (scope: string): void => {
    const mine = ++loads;
    void stores.tools.load(scope).catch(() => null).then((saved) => {
      if (mine !== loads || stores.scope() !== scope) return;
      tools = { scope, prefs: adoptFileParts(scope, saved) };
      changed();
    });
  };

  return {
    order: 95,
    read() {
      const scope = stores.scope();
      if (tools?.scope !== scope) return undefined;
      const file = fileParts(scope);
      const value: MediaSettings = {};
      const agent = stores.agent.read(scope) ?? file.agent;
      if (agent) value.agent = agent;
      const models = stores.models.read(scope) ?? file.models;
      if (models && Object.keys(models).length) value.models = models;
      const view = stores.view.read() ?? file.view;
      if (view) value.view = view;
      const toolPrefs = tools.prefs ? toolSettingsOf(tools.prefs) : file.tools;
      if (toolPrefs) value.tools = toolPrefs;
      if (!Object.keys(value).length) return undefined;
      remember(scope, value);
      return value;
    },
    apply(raw) {
      const merging = raw !== null && raw === merged;
      merged = null;
      const value = narrowMediaSettings(raw);
      const scope = stores.scope();
      remember(scope, value);
      if (value.agent) stores.agent.write(scope, value.agent);
      if (value.models) stores.models.write(scope, value.models);
      if (value.view) stores.view.write(value.view);
      if (value.tools) {
        const fromFile = value.tools;
        // A load still on its way would put back what this replaces.
        loads += 1;
        const known = tools?.scope === scope ? tools.prefs : undefined;
        tools = { scope, prefs: { favorites: [], pins: [], ...known, ...fromFile } };
        if (!merging || known !== undefined) {
          void stores.tools.save(scope, fromFile).catch(() => undefined);
          return;
        }
        // A merge before this browser's preferences were read: they are kept beside the file's, once read.
        const mine = loads;
        void stores.tools.load(scope).catch(() => null).then(async (saved) => {
          const both = saved ? mergeMediaSettings({ tools: fromFile }, { tools: toolSettingsOf(saved) }).tools ?? fromFile : fromFile;
          await stores.tools.save(scope, both);
          if (mine !== loads || stores.scope() !== scope) return;
          tools = { scope, prefs: { favorites: [], pins: [], ...saved, ...both } };
          changed();
        }).catch(() => undefined);
      }
    },
    merge(fromFile, local) {
      // `local` is nothing while the Tools preferences are being read; the rest is there to keep.
      merged = mergeMediaSettings(narrowMediaSettings(fromFile), local === undefined ? ownParts(stores.scope()) : narrowMediaSettings(local));
      return merged;
    },
    subscribe(onChange) {
      changed = onChange;
      const stops = [
        stores.agent.subscribe(onChange),
        stores.models.subscribe(onChange),
        stores.view.subscribe(onChange),
        stores.tools.subscribe((scope) => {
          if (scope === stores.scope()) loadTools(scope);
        }),
        stores.onScopeChange((next) => {
          tools = null;
          loadTools(next);
        }),
      ];
      loadTools(stores.scope());
      return () => {
        changed = () => {};
        loads += 1;
        for (const stop of stops) stop();
      };
    },
  };
}

const REMEMBERED_PREFIX = 'willow:media:settings-file:v1:';

/** `MediaSettingsStores.remembered` in this browser's localStorage. */
export const rememberedInLocalStorage: MediaSettingsStores['remembered'] = {
  read(folder) {
    try {
      return JSON.parse(globalThis.localStorage?.getItem(REMEMBERED_PREFIX + folder) ?? 'null');
    } catch {
      return null;
    }
  },
  write(folder, value) {
    try {
      const text = JSON.stringify(value);
      if (globalThis.localStorage?.getItem(REMEMBERED_PREFIX + folder) !== text) globalThis.localStorage?.setItem(REMEMBERED_PREFIX + folder, text);
    } catch {
      // Unremembered, a scope new to the folder starts from nothing, as it did before.
    }
  },
};
