/**
 * Waifu Companion State Store
 * Manages active model, persona, audio settings, positioning, and conversation history.
 */

import { atom } from 'nanostores';
import { requestSyncedFolderPass } from '@willow/storage/local-sync';
import { DEFAULT_MODEL, Live2DModelMeta, WAIFU_MODELS } from './waifu-models';
import { DEFAULT_PERSONA, WAIFU_PERSONAS, WaifuEmotion, WaifuPersona } from './waifu-personas';
import {
  COMPANION_HISTORY_EVENT,
  COMPANION_HISTORY_KEY,
  COMPANION_HISTORY_LIMIT,
  parseCompanionHistory,
  readCompanionHistory,
} from './companion-history';

export interface WaifuMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  emotion?: WaifuEmotion;
  timestamp: number;
}

export interface WaifuSettings {
  voiceEnabled: boolean;
  voicePitch: number;
  voiceRate: number;
  voiceVolume: number;
  liveVoice: string;
  particlesEnabled: boolean;
  modelScale: number;
  backgroundTheme: 'cyberpunk' | 'cherry-blossom' | 'cozy-room' | 'minimal' | 'gradient';
}

const STORAGE_KEYS = {
  MODEL: 'willow:waifu:model-id',
  /** An avatar loaded from its own URL, which no gallery entry can stand for. */
  CUSTOM_MODEL: 'willow:waifu:custom-model',
  PERSONA: 'willow:waifu:persona-id',
  SETTINGS: 'willow:waifu:settings',
};

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

const isModelMeta = (value: unknown): value is Live2DModelMeta => {
  if (!value || typeof value !== 'object') return false;
  const model = value as Record<string, unknown>;
  return typeof model.id === 'string' && typeof model.name === 'string' && typeof model.url === 'string' && typeof model.image === 'string';
};

/** The avatar `id` names: one of the gallery's, or `custom` when it is that one loaded from its own URL. */
export const companionModelFor = (id: unknown, custom?: unknown): Live2DModelMeta | null => {
  if (typeof id !== 'string') return null;
  return WAIFU_MODELS.find((model) => model.id === id) ?? (isModelMeta(custom) && custom.id === id ? custom : null);
};

export const companionPersonaFor = (id: unknown): WaifuPersona | null =>
  WAIFU_PERSONAS.find((persona) => persona.id === id) ?? null;

export const activeModelStore = atom<Live2DModelMeta>(
  companionModelFor(localStorageText(STORAGE_KEYS.MODEL), readJSON<unknown>(STORAGE_KEYS.CUSTOM_MODEL, null)) ?? DEFAULT_MODEL,
);
export const activePersonaStore = atom<WaifuPersona>(companionPersonaFor(localStorageText(STORAGE_KEYS.PERSONA)) ?? DEFAULT_PERSONA);
export const currentEmotionStore = atom<WaifuEmotion>('neutral');

function localStorageText(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export const DEFAULT_WAIFU_SETTINGS: WaifuSettings = {
  voiceEnabled: true,
  voicePitch: 1.2,
  voiceRate: 1.05,
  voiceVolume: 1.0,
  liveVoice: 'Aoede',
  particlesEnabled: true,
  modelScale: 0.35,
  backgroundTheme: 'cozy-room',
};

export const waifuSettingsStore = atom<WaifuSettings>({
  ...DEFAULT_WAIFU_SETTINGS,
  ...readJSON<Partial<WaifuSettings>>(STORAGE_KEYS.SETTINGS, {}),
});

const savedHistory = readCompanionHistory() as WaifuMessage[] | null;
export const waifuHistoryStore = atom<WaifuMessage[]>(savedHistory?.length ? savedHistory : [
  {
    id: 'welcome',
    role: 'assistant',
    text: DEFAULT_PERSONA.initialGreeting,
    emotion: 'happy',
    timestamp: Date.now(),
  },
]);

// Kept in this browser, and from there in the user's folder (`register-companion-history.ts`).
waifuHistoryStore.listen((history) => {
  try {
    localStorage.setItem(COMPANION_HISTORY_KEY, JSON.stringify(history.slice(-COMPANION_HISTORY_LIMIT)));
  } catch {}
  requestSyncedFolderPass();
});

if (typeof window !== 'undefined') {
  const adopt = (history: unknown) => {
    const parsed = parseCompanionHistory(history);
    if (parsed && JSON.stringify(parsed) !== JSON.stringify(waifuHistoryStore.get())) {
      waifuHistoryStore.set(parsed as WaifuMessage[]);
    }
  };
  window.addEventListener(COMPANION_HISTORY_EVENT, (event) => adopt((event as CustomEvent<unknown>).detail));
  window.addEventListener('storage', (event) => {
    if (event.key === COMPANION_HISTORY_KEY) adopt(readCompanionHistory());
  });
}

export function setActiveModel(model: Live2DModelMeta) {
  activeModelStore.set(model);
  try {
    localStorage.setItem(STORAGE_KEYS.MODEL, model.id);
    if (WAIFU_MODELS.some((entry) => entry.id === model.id)) localStorage.removeItem(STORAGE_KEYS.CUSTOM_MODEL);
    else localStorage.setItem(STORAGE_KEYS.CUSTOM_MODEL, JSON.stringify(model));
  } catch {}
}

const BACKGROUND_THEMES: ReadonlyArray<WaifuSettings['backgroundTheme']> = ['cyberpunk', 'cherry-blossom', 'cozy-room', 'minimal', 'gradient'];

/** The companion's settings from `value` (`settings.json`, hand-edited perhaps): what is valid, over the defaults. */
export function replaceWaifuSettings(value: unknown) {
  if (!value || typeof value !== 'object') return;
  const given = value as Record<string, unknown>;
  const next: WaifuSettings = { ...DEFAULT_WAIFU_SETTINGS };
  for (const key of ['voiceEnabled', 'particlesEnabled'] as const) {
    if (typeof given[key] === 'boolean') next[key] = given[key] as boolean;
  }
  for (const key of ['voicePitch', 'voiceRate', 'voiceVolume', 'modelScale'] as const) {
    if (typeof given[key] === 'number' && Number.isFinite(given[key])) next[key] = given[key] as number;
  }
  if (typeof given.liveVoice === 'string' && given.liveVoice) next.liveVoice = given.liveVoice;
  if (BACKGROUND_THEMES.includes(given.backgroundTheme as WaifuSettings['backgroundTheme'])) {
    next.backgroundTheme = given.backgroundTheme as WaifuSettings['backgroundTheme'];
  }
  if (JSON.stringify(next) !== JSON.stringify(waifuSettingsStore.get())) updateWaifuSettings(next);
}

export function setActivePersona(persona: WaifuPersona) {
  activePersonaStore.set(persona);
  try {
    localStorage.setItem(STORAGE_KEYS.PERSONA, persona.id);
  } catch {}
}

export function updateWaifuSettings(partial: Partial<WaifuSettings>) {
  const next = { ...waifuSettingsStore.get(), ...partial };
  waifuSettingsStore.set(next);
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(next));
  } catch {}
}

export function appendWaifuMessage(msg: Omit<WaifuMessage, 'id' | 'timestamp'>) {
  const newMsg: WaifuMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    ...msg,
  };
  waifuHistoryStore.set([...waifuHistoryStore.get(), newMsg]);
  return newMsg;
}

export function clearWaifuHistory() {
  const persona = activePersonaStore.get();
  waifuHistoryStore.set([
    {
      id: `welcome-${Date.now()}`,
      role: 'assistant',
      text: persona.initialGreeting,
      emotion: 'happy',
      timestamp: Date.now(),
    },
  ]);
}
