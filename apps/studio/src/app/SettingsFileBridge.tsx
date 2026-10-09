/**
 * The parts of `settings.json` held in React state (see `register-settings-file.ts` for the rest):
 *
 * - `baseUrls`: each provider's endpoint, which the model setup carries for the streaming layer.
 * - `providers`: each provider's API format and tool policy (its built-in profile in the model setup).
 * - `model`: the model the composer picks, and the system defaults (renaming, transcription, …).
 * - `appearance`: theme, workspace colour and background. Registered once auth has settled, so an
 *   account's own colour is the one written, not the device's from before its profile arrived.
 *
 * Renders nothing. The sections are registered once and read the latest props through a ref, which
 * an `apply` updates at once: React state lands on the next render, and the file is composed
 * straight after an apply, from what `read` answers.
 */

import React from 'react';
import { collectSavedModelsInCatalogOrder } from '@willow/core/model-catalog';
import { registerSettingsSection } from '@willow/core/settings-file';
import {
  DEFAULT_PROFILE_IDS,
  defaultApiFormatForProvider,
  defaultToolPolicyForProvider,
  type ProviderApiFormat,
  type ProviderToolPolicy,
} from '@willow/ai/providers/profiles';
import { $themeChoice, setThemeChoice } from '@willow/core/theme-mode';
import { WORKSPACE_COLOR_DEFINITIONS } from '@willow/core/workspace-theme';
import { useAuth } from '@willow/auth/AuthContext';
import { useBackground, type BackgroundType } from '../shell/BackgroundContext';
import { PROVIDER_IDS, applyProviderValues, readDeviceProviderState } from '../settings/provider-settings';
import { subscribeProviderValues } from './register-settings-file';

type Json = Record<string, unknown>;
type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

const isObject = (value: unknown): value is Json =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const BACKGROUNDS: readonly BackgroundType[] = ['solid', 'waves', 'lines'];
const THEMES = ['system', 'light', 'dark'] as const;
/** How long a selection naming a model this copy does not have yet waits for the folder's models list. */
const HELD_SELECTION_MS = 30_000;

const hasModel = (modelConfig: any, selected: string): boolean => {
  const id = selected.split('::effort-')[0];
  return collectSavedModelsInCatalogOrder(modelConfig).some((model) => model.id === id);
};

const API_FORMATS: readonly ProviderApiFormat[] = ['native-gemini', 'openai-chat-completions', 'openai-responses', 'anthropic-messages', 'xai-chat-completions'];
const TOOL_POLICIES: readonly ProviderToolPolicy[] = ['provider-native', 'function-calling', 'disabled'];

const builtInProfile = (modelConfig: any, provider: typeof PROVIDER_IDS[number]): any =>
  (Array.isArray(modelConfig?.providerProfiles) ? modelConfig.providerProfiles : [])
    .find((profile: any) => profile?.id === DEFAULT_PROFILE_IDS[provider]);

interface Props {
  selectedModelId: string;
  setSelectedModelId: Setter<string>;
  modelConfig: any;
  setModelConfig: Setter<any>;
  /** Maps a retired model id in the system defaults to the one that replaced it. */
  liveSystemDefaults: <T extends Record<string, unknown>>(defaults: T) => T;
}

const useListeners = () => {
  const listeners = React.useRef(new Set<() => void>());
  const subscribe = React.useCallback((onChange: () => void) => {
    listeners.current.add(onChange);
    return () => {
      listeners.current.delete(onChange);
    };
  }, []);
  const notify = React.useCallback(() => listeners.current.forEach((listener) => listener()), []);
  return { subscribe, notify };
};

export function SettingsFileBridge(props: Props) {
  const { workspaceColor, setWorkspaceColor, loading } = useAuth();
  const { background, setBackground } = useBackground();
  const latest = React.useRef({ ...props, workspaceColor, setWorkspaceColor, background, setBackground });
  latest.current = { ...props, workspaceColor, setWorkspaceColor, background, setBackground };

  const model = useListeners();
  const appearance = useListeners();

  /*
   * A selection the file names before this copy has the folder's models — a fresh copy attaches
   * `settings.json` before it takes `Models/catalog.json` — is held rather than lost: the composer falls
   * back to the first model meanwhile, the file keeps the choice, and it is applied once the list arrives
   * with it. Held for a while only, so a model since removed cannot pin the file to it.
   */
  const heldSelection = React.useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const releaseSelection = React.useCallback(() => {
    if (!heldSelection.current) return;
    clearTimeout(heldSelection.current.timer);
    heldSelection.current = null;
    model.notify();
  }, [model.notify]);
  React.useEffect(() => {
    const held = heldSelection.current;
    if (!held || !hasModel(props.modelConfig, held.id)) return;
    clearTimeout(held.timer);
    heldSelection.current = null;
    latest.current = { ...latest.current, selectedModelId: held.id };
    props.setSelectedModelId(held.id);
  }, [props.modelConfig]);
  React.useEffect(() => () => {
    if (heldSelection.current) clearTimeout(heldSelection.current.timer);
  }, []);

  React.useEffect(() => {
    const stops = [
      registerSettingsSection('baseUrls', {
        order: 20,
        read: () => {
          const state = readDeviceProviderState();
          return Object.fromEntries(PROVIDER_IDS.map((provider) => [provider, state[provider].baseUrl]));
        },
        apply: (value) => {
          if (!isObject(value)) return;
          applyProviderValues(Object.fromEntries(PROVIDER_IDS
            .filter((provider) => typeof value[provider] === 'string')
            .map((provider) => [provider, { baseUrl: value[provider] as string }])), latest.current.setModelConfig);
        },
        subscribe: subscribeProviderValues,
      }),
      registerSettingsSection('providers', {
        order: 25,
        read: () => Object.fromEntries(PROVIDER_IDS.map((provider) => {
          const profile = builtInProfile(latest.current.modelConfig, provider);
          return [provider, {
            apiFormat: profile?.apiFormat ?? defaultApiFormatForProvider(provider),
            toolPolicy: profile?.toolPolicy ?? defaultToolPolicyForProvider(provider),
          }];
        })),
        apply: (value) => {
          if (!isObject(value)) return;
          const given = new Map<string, { apiFormat?: ProviderApiFormat; toolPolicy?: ProviderToolPolicy }>();
          for (const provider of PROVIDER_IDS) {
            const entry = value[provider];
            if (!isObject(entry)) continue;
            given.set(DEFAULT_PROFILE_IDS[provider], {
              ...(API_FORMATS.includes(entry.apiFormat as ProviderApiFormat) ? { apiFormat: entry.apiFormat as ProviderApiFormat } : {}),
              ...(TOOL_POLICIES.includes(entry.toolPolicy as ProviderToolPolicy) ? { toolPolicy: entry.toolPolicy as ProviderToolPolicy } : {}),
            });
          }
          const update = (config: any) => {
            if (!Array.isArray(config?.providerProfiles)) return config;
            let changed = false;
            const providerProfiles = config.providerProfiles.map((profile: any) => {
              const change = given.get(profile?.id);
              if (!change || Object.entries(change).every(([key, entry]) => profile[key] === entry)) return profile;
              changed = true;
              return { ...profile, ...change, updatedAt: Date.now() };
            });
            return changed ? { ...config, providerProfiles } : config;
          };
          const current = latest.current;
          latest.current = { ...latest.current, modelConfig: update(latest.current.modelConfig) };
          current.setModelConfig(update);
        },
        subscribe: model.subscribe,
      }),
      registerSettingsSection('model', {
        order: 30,
        read: () => ({
          selected: heldSelection.current?.id ?? latest.current.selectedModelId,
          systemDefaults: latest.current.modelConfig?.systemDefaults ?? {},
        }),
        apply: (value) => {
          if (!isObject(value)) return;
          const current = latest.current;
          if (typeof value.selected === 'string') {
            const selected = value.selected;
            latest.current = { ...latest.current, selectedModelId: selected };
            current.setSelectedModelId(selected);
            if (heldSelection.current) clearTimeout(heldSelection.current.timer);
            heldSelection.current = selected && !hasModel(current.modelConfig, selected)
              ? { id: selected, timer: setTimeout(releaseSelection, HELD_SELECTION_MS) }
              : null;
          }
          if (isObject(value.systemDefaults)) {
            const given = Object.fromEntries(Object.entries(value.systemDefaults)
              .filter(([, entry]) => ['string', 'number', 'boolean'].includes(typeof entry)));
            const merge = (previous: any) => current.liveSystemDefaults({ ...(previous?.systemDefaults ?? {}), ...given });
            latest.current = {
              ...latest.current,
              modelConfig: { ...latest.current.modelConfig, systemDefaults: merge(latest.current.modelConfig) },
            };
            current.setModelConfig((previous: any) => ({ ...previous, systemDefaults: merge(previous) }));
          }
        },
        subscribe: model.subscribe,
      }),
    ];
    return () => stops.forEach((stop) => stop());
  }, [model.subscribe, releaseSelection]);

  React.useEffect(() => {
    if (loading) return;
    return registerSettingsSection('appearance', {
      order: 40,
      read: () => ({
        theme: $themeChoice.get(),
        color: latest.current.workspaceColor,
        background: latest.current.background,
      }),
      apply: (value) => {
        if (!isObject(value)) return;
        const current = latest.current;
        if (THEMES.includes(value.theme as typeof THEMES[number]) && value.theme !== $themeChoice.get()) {
          setThemeChoice(value.theme as typeof THEMES[number]);
        }
        if (value.color !== current.workspaceColor && WORKSPACE_COLOR_DEFINITIONS.some((definition) => definition.id === value.color)) {
          const color = value.color as typeof current.workspaceColor;
          latest.current = { ...latest.current, workspaceColor: color };
          void current.setWorkspaceColor(color);
        }
        if (value.background !== current.background && BACKGROUNDS.includes(value.background as BackgroundType)) {
          const chosen = value.background as BackgroundType;
          latest.current = { ...latest.current, background: chosen };
          current.setBackground(chosen);
        }
      },
      subscribe: (onChange) => {
        const stops = [$themeChoice.listen(onChange), appearance.subscribe(onChange)];
        return () => stops.forEach((stop) => stop());
      },
    });
  }, [loading, appearance.subscribe]);

  const systemDefaults = JSON.stringify(props.modelConfig?.systemDefaults ?? {});
  const providerFormats = JSON.stringify(PROVIDER_IDS.map((provider) => {
    const profile = builtInProfile(props.modelConfig, provider);
    return [profile?.apiFormat, profile?.toolPolicy];
  }));
  React.useEffect(model.notify, [props.selectedModelId, systemDefaults, providerFormats, model.notify]);
  React.useEffect(appearance.notify, [workspaceColor, background, appearance.notify]);

  return null;
}
