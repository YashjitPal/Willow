/**
 * Per-provider voice and language selection.
 *
 * Keyed by provider id rather than held as a single pair, so a future
 * non-Gemini live model keeps its own voice and language instead of inheriting
 * whatever was last chosen for Gemini — the "plug and play" half of
 * [voice-providers.ts]: add a provider, and its selection persists separately
 * with no change here.
 *
 * A nanostore for the same reason experiments-store.ts is one: the value is read
 * by ChatView when it opens a session and written by the settings panel, which
 * sit in different parts of the tree.
 */

import { atom } from 'nanostores';

import {
  AUTO_LANGUAGE,
  buildLanguageDirective,
  findVoiceProvider,
  resolveLanguage,
  resolveVoice,
  type LanguageOption,
  type VoiceOption,
  type VoiceProvider,
} from './voice-providers';

export type VoiceSelection = {
  voiceId: string;
  languageCode: string;
};

/** providerId → selection. Providers with no stored choice are simply absent. */
export type VoiceSettingsState = Record<string, VoiceSelection>;

const STORAGE_KEY = 'willow:voice-settings';

/**
 * Read persisted selections.
 *
 * Entries are kept even for providers this build does not know — an id that
 * belongs to a provider added back later should not lose its selection in the
 * meantime. What is validated is the shape, so a corrupt entry cannot reach the
 * request builder. Resolution against the live roster happens at read time in
 * `getVoiceSelection`, so a voice retired from the API falls back to the
 * provider default rather than being sent on the wire.
 */
const readStored = (): VoiceSettingsState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: VoiceSettingsState = {};
    for (const [providerId, value] of Object.entries(parsed ?? {})) {
      const entry = value as Partial<VoiceSelection> | null;
      if (!entry || typeof entry !== 'object') continue;
      if (typeof entry.voiceId !== 'string' || typeof entry.languageCode !== 'string') continue;
      next[providerId] = { voiceId: entry.voiceId, languageCode: entry.languageCode };
    }
    return next;
  } catch {
    // Corrupt or unavailable storage must not stop the app booting.
    return {};
  }
};

export const voiceSettingsStore = atom<VoiceSettingsState>(readStored());

const persist = (state: VoiceSettingsState): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A failed write only costs persistence; the in-memory choice still applies.
  }
};

/**
 * The stored selection for a provider, resolved against its current roster.
 *
 * Always returns real options, so callers never have to handle a voice id that
 * no longer exists.
 */
export const getVoiceSelection = (
  provider: VoiceProvider,
  state: VoiceSettingsState = voiceSettingsStore.get(),
): { voice: VoiceOption; language: LanguageOption } => {
  const stored = state[provider.id];
  return {
    voice: resolveVoice(provider, stored?.voiceId),
    language: resolveLanguage(provider, stored?.languageCode),
  };
};

const update = (provider: VoiceProvider, patch: Partial<VoiceSelection>): void => {
  const state = voiceSettingsStore.get();
  const current = getVoiceSelection(provider, state);
  const next: VoiceSettingsState = {
    ...state,
    [provider.id]: {
      voiceId: patch.voiceId ?? current.voice.id,
      languageCode: patch.languageCode ?? current.language.code,
    },
  };
  voiceSettingsStore.set(next);
  persist(next);
};

export const setVoice = (provider: VoiceProvider, voiceId: string): void =>
  update(provider, { voiceId });

export const setLanguage = (provider: VoiceProvider, languageCode: string): void =>
  update(provider, { languageCode });

/**
 * What a session should be started with for `modelId`.
 *
 * Null when no provider claims the model — the caller then starts the session
 * exactly as it does today, with no voice or language on the request, so an
 * unrecognised model is never handed a Gemini voice name.
 */
export const getSessionVoiceSettings = (
  modelId: string,
): { provider: VoiceProvider; voice: VoiceOption; language: LanguageOption } | null => {
  const provider = findVoiceProvider(modelId);
  if (!provider) return null;
  return { provider, ...getVoiceSelection(provider) };
};

/**
 * The live-session options implied by the current selection.
 *
 * Both halves are deliberately conservative, so a session started with the
 * defaults is byte-identical to one started before this feature existed:
 *
 *   - `languageCode` is only ever set for a `speechConfig`-mode provider, and
 *     never for Auto-detect. Gemini's native-audio Live models reject an explicit
 *     code, so theirs is folded into the prompt instead.
 *   - `systemPrompt` comes back unchanged unless a specific language is chosen.
 *
 * `voiceName` is the one thing always sent once a provider matches — see the
 * note on `defaultVoiceId` in voice-providers.ts for why naming the voice
 * explicitly is what makes the displayed name true.
 */
export const buildLiveVoiceOptions = (
  modelId: string,
  systemPrompt: string,
): { systemPrompt: string; voiceName?: string; languageCode?: string } => {
  const settings = getSessionVoiceSettings(modelId);
  if (!settings) return { systemPrompt };

  const { provider, voice, language } = settings;
  const isAuto = language.code === AUTO_LANGUAGE;

  const directive =
    provider.languageMode === 'systemInstruction' ? buildLanguageDirective(language) : '';

  return {
    systemPrompt: directive ? `${systemPrompt}\n\n${directive}` : systemPrompt,
    voiceName: voice.id,
    languageCode:
      provider.languageMode === 'speechConfig' && !isAuto ? language.code : undefined,
  };
};

/**
 * Identity of the settings a session was opened with.
 *
 * Compared against the current value to decide whether a live session has to be
 * reopened — voice and language are fixed at setup time on the wire, so a change
 * mid-session only takes effect on reconnect.
 */
export const voiceSettingsSignature = (modelId: string): string => {
  const settings = getSessionVoiceSettings(modelId);
  if (!settings) return '';
  return `${settings.provider.id}:${settings.voice.id}:${settings.language.code}`;
};
