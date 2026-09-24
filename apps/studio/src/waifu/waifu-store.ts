/**
 * Waifu Companion State Store
 * Manages active model, persona, audio settings, positioning, and conversation history.
 */

import { atom } from 'nanostores';
import { DEFAULT_MODEL, Live2DModelMeta } from './waifu-models';
import { DEFAULT_PERSONA, WaifuEmotion, WaifuPersona } from './waifu-personas';

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
  PERSONA: 'willow:waifu:persona-id',
  SETTINGS: 'willow:waifu:settings',
  HISTORY: 'willow:waifu:history',
};

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export const activeModelStore = atom<Live2DModelMeta>(DEFAULT_MODEL);
export const activePersonaStore = atom<WaifuPersona>(DEFAULT_PERSONA);
export const currentEmotionStore = atom<WaifuEmotion>('neutral');

export const waifuSettingsStore = atom<WaifuSettings>(
  readJSON<WaifuSettings>(STORAGE_KEYS.SETTINGS, {
    voiceEnabled: true,
    voicePitch: 1.2,
    voiceRate: 1.05,
    voiceVolume: 1.0,
    liveVoice: 'Aoede',
    particlesEnabled: true,
    modelScale: 0.35,
    backgroundTheme: 'cozy-room',
  })
);

export const waifuHistoryStore = atom<WaifuMessage[]>([
  {
    id: 'welcome',
    role: 'assistant',
    text: DEFAULT_PERSONA.initialGreeting,
    emotion: 'happy',
    timestamp: Date.now(),
  },
]);

export function setActiveModel(model: Live2DModelMeta) {
  activeModelStore.set(model);
  try {
    localStorage.setItem(STORAGE_KEYS.MODEL, model.id);
  } catch {}
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
