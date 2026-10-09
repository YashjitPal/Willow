/**
 * The parts of `settings.json` held in React state (see `register-settings-file.ts` for the rest):
 *
 * - `baseUrls`: each provider's endpoint, which the model setup carries for the streaming layer.
 * - `model`: the model the composer picks, and the system defaults (renaming, transcription, …).
 * - `appearance`: theme, workspace colour and background. Registered once auth has settled, so an
 *   account's own colour is the one written, not the device's from before its profile arrived.
 *
 * Renders nothing. The sections are registered once and read the latest props through a ref, which
 * an `apply` updates at once: React state lands on the next render, and the file is composed
 * straight after an apply, from what `read` answers.
 */

import React from 'react';
import { registerSettingsSection } from '@willow/core/settings-file';
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
      registerSettingsSection('model', {
        order: 30,
        read: () => ({
          selected: latest.current.selectedModelId,
          systemDefaults: latest.current.modelConfig?.systemDefaults ?? {},
        }),
        apply: (value) => {
          if (!isObject(value)) return;
          const current = latest.current;
          if (typeof value.selected === 'string') {
            const selected = value.selected;
            latest.current = { ...latest.current, selectedModelId: selected };
            current.setSelectedModelId(selected);
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
  }, [model.subscribe]);

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
  React.useEffect(model.notify, [props.selectedModelId, systemDefaults, model.notify]);
  React.useEffect(appearance.notify, [workspaceColor, background, appearance.notify]);

  return null;
}
