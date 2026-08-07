/**
 * Voice-provider registry.
 *
 * The panel's UI is a clone of a fixed nine-voice picker; Willow's has to serve
 * whatever live model is running, and more than one family of them eventually.
 * So the panel reads its roster from here and never names a provider: it asks
 * for the provider that `matches()` the active model id, renders that
 * provider's `voices` as the carousel and its `languages` as the Language row,
 * and stores the selection under the provider's `id`. Adding a non-Gemini live
 * model is one more entry in PROVIDERS — no change to the components.
 *
 * The Gemini rosters below are the documented ones (30 prebuilt voices with
 * their published characteristics, 97 BCP-47 codes), not a sample.
 */

import { LIVE_MODEL_ID } from '@willow/ai/live';

/**
 * One live model a provider can run.
 *
 * `matches()` classifies a model id; this enumerates them, which is what the
 * composer's picker needs — it has to list the roster before anything is
 * selected, and there is nothing to pattern-match against yet. Kept here rather
 * than read off the user's saved models because these are the ids voice mode
 * actually opens a socket with, and a model can be missing from Settings →
 * Models while still being the one live mode runs.
 */
export type VoiceModelOption = {
  /** Sent as the Live API `model`. */
  id: string;
  /** Shown in the picker when no saved model supplies a name for this id. */
  name: string;
};

/** A model plus the provider that runs it, which is the picker's second line. */
export type VoiceModelListing = VoiceModelOption & {
  providerId: string;
  providerLabel: string;
};

/** One entry in the voice carousel: dot, name, and the line under it. */
export type VoiceOption = {
  /** Sent to the API verbatim — for Gemini, `prebuiltVoiceConfig.voiceName`. */
  id: string;
  /** Shown at `text-xl font-semibold`. */
  name: string;
  /** Shown at `text-sm` under the name, and as the dot's accessible hint. */
  description: string;
};

/** One entry in the Language dropdown. */
export type LanguageOption = {
  /** BCP-47, or AUTO_LANGUAGE for the leading "Auto-detect" row. */
  code: string;
  label: string;
};

/**
 * How a provider takes a language.
 *
 * `speechConfig` — the request carries an explicit `languageCode`.
 * `systemInstruction` — the model picks the language itself and rejects an
 * explicit code, so the choice has to be steered by appending a directive to
 * the system prompt. Gemini's native-audio live models are documented as
 * "automatically choose the appropriate language and don't support explicitly
 * setting the language code", which is why this axis exists at all rather than
 * every provider being handed a `languageCode`.
 */
export type LanguageMode = 'speechConfig' | 'systemInstruction';

export type VoiceProvider = {
  /** Stable key for persistence. Never shown. */
  id: string;
  /** Shown as the second line of each of this provider's rows in the picker. */
  label: string;
  /** True when this provider serves the given live model id. */
  matches: (modelId: string) => boolean;
  /** The live models this provider can run, in the order the picker lists them. */
  models: VoiceModelOption[];
  voices: VoiceOption[];
  languages: LanguageOption[];
  languageMode: LanguageMode;
  defaultVoiceId: string;
  defaultLanguageCode: string;
};

/** The "Auto-detect" row: upstream's default, and the no-directive case here. */
export const AUTO_LANGUAGE = 'auto';

/**
 * Gemini's 30 prebuilt voices, in the documented order, each with its published
 * characteristic as the description line. The ids are what
 * `prebuiltVoiceConfig.voiceName` accepts, so they are case-sensitive.
 */
export const GEMINI_VOICES: VoiceOption[] = [
  { id: 'Zephyr', name: 'Zephyr', description: 'Bright' },
  { id: 'Puck', name: 'Puck', description: 'Upbeat' },
  { id: 'Charon', name: 'Charon', description: 'Informative' },
  { id: 'Kore', name: 'Kore', description: 'Firm' },
  { id: 'Fenrir', name: 'Fenrir', description: 'Excitable' },
  { id: 'Leda', name: 'Leda', description: 'Youthful' },
  { id: 'Orus', name: 'Orus', description: 'Firm' },
  { id: 'Aoede', name: 'Aoede', description: 'Breezy' },
  { id: 'Callirrhoe', name: 'Callirrhoe', description: 'Easy-going' },
  { id: 'Autonoe', name: 'Autonoe', description: 'Bright' },
  { id: 'Enceladus', name: 'Enceladus', description: 'Breathy' },
  { id: 'Iapetus', name: 'Iapetus', description: 'Clear' },
  { id: 'Umbriel', name: 'Umbriel', description: 'Easy-going' },
  { id: 'Algieba', name: 'Algieba', description: 'Smooth' },
  { id: 'Despina', name: 'Despina', description: 'Smooth' },
  { id: 'Erinome', name: 'Erinome', description: 'Clear' },
  { id: 'Algenib', name: 'Algenib', description: 'Gravelly' },
  { id: 'Rasalgethi', name: 'Rasalgethi', description: 'Informative' },
  { id: 'Laomedeia', name: 'Laomedeia', description: 'Upbeat' },
  { id: 'Achernar', name: 'Achernar', description: 'Soft' },
  { id: 'Alnilam', name: 'Alnilam', description: 'Firm' },
  { id: 'Schedar', name: 'Schedar', description: 'Even' },
  { id: 'Gacrux', name: 'Gacrux', description: 'Mature' },
  { id: 'Pulcherrima', name: 'Pulcherrima', description: 'Forward' },
  { id: 'Achird', name: 'Achird', description: 'Friendly' },
  { id: 'Zubenelgenubi', name: 'Zubenelgenubi', description: 'Casual' },
  { id: 'Vindemiatrix', name: 'Vindemiatrix', description: 'Gentle' },
  { id: 'Sadachbia', name: 'Sadachbia', description: 'Lively' },
  { id: 'Sadaltager', name: 'Sadaltager', description: 'Knowledgeable' },
  { id: 'Sulafat', name: 'Sulafat', description: 'Warm' },
];

/**
 * Gemini's 97 supported languages, behind the same leading "Auto-detect" row the
 * shipped panel opens on.
 *
 * Codes and names are paired positionally from the documented list, which is
 * ordered by English name — so the array is already in the order the dropdown
 * should render, and no sort is applied. Two of the codes are the legacy
 * spellings the API returns rather than the modern ISO ones (`iw` for Hebrew,
 * `fil` for Filipino); they are kept as documented since they go on the wire.
 */
export const GEMINI_LANGUAGES: LanguageOption[] = [
  { code: AUTO_LANGUAGE, label: 'Auto-detect' },
  { code: 'af', label: 'Afrikaans' },
  { code: 'ak', label: 'Akan' },
  { code: 'sq', label: 'Albanian' },
  { code: 'am', label: 'Amharic' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hy', label: 'Armenian' },
  { code: 'as', label: 'Assamese' },
  { code: 'az', label: 'Azerbaijani' },
  { code: 'eu', label: 'Basque' },
  { code: 'be', label: 'Belarusian' },
  { code: 'bn', label: 'Bengali' },
  { code: 'bs', label: 'Bosnian' },
  { code: 'bg', label: 'Bulgarian' },
  { code: 'my', label: 'Burmese' },
  { code: 'ca', label: 'Catalan' },
  { code: 'ceb', label: 'Cebuano' },
  { code: 'zh', label: 'Chinese' },
  { code: 'hr', label: 'Croatian' },
  { code: 'cs', label: 'Czech' },
  { code: 'da', label: 'Danish' },
  { code: 'nl', label: 'Dutch' },
  { code: 'en', label: 'English' },
  { code: 'et', label: 'Estonian' },
  { code: 'fo', label: 'Faroese' },
  { code: 'fil', label: 'Filipino' },
  { code: 'fi', label: 'Finnish' },
  { code: 'fr', label: 'French' },
  { code: 'gl', label: 'Galician' },
  { code: 'ka', label: 'Georgian' },
  { code: 'de', label: 'German' },
  { code: 'el', label: 'Greek' },
  { code: 'gu', label: 'Gujarati' },
  { code: 'ha', label: 'Hausa' },
  { code: 'iw', label: 'Hebrew' },
  { code: 'hi', label: 'Hindi' },
  { code: 'hu', label: 'Hungarian' },
  { code: 'is', label: 'Icelandic' },
  { code: 'id', label: 'Indonesian' },
  { code: 'ga', label: 'Irish' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'kn', label: 'Kannada' },
  { code: 'kk', label: 'Kazakh' },
  { code: 'km', label: 'Khmer' },
  { code: 'rw', label: 'Kinyarwanda' },
  { code: 'ko', label: 'Korean' },
  { code: 'ku', label: 'Kurdish' },
  { code: 'ky', label: 'Kyrgyz' },
  { code: 'lo', label: 'Lao' },
  { code: 'lv', label: 'Latvian' },
  { code: 'lt', label: 'Lithuanian' },
  { code: 'mk', label: 'Macedonian' },
  { code: 'ms', label: 'Malay' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'mt', label: 'Maltese' },
  { code: 'mi', label: 'Maori' },
  { code: 'mr', label: 'Marathi' },
  { code: 'mn', label: 'Mongolian' },
  { code: 'ne', label: 'Nepali' },
  { code: 'no', label: 'Norwegian' },
  { code: 'or', label: 'Odia' },
  { code: 'om', label: 'Oromo' },
  { code: 'ps', label: 'Pashto' },
  { code: 'fa', label: 'Persian' },
  { code: 'pl', label: 'Polish' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'pa', label: 'Punjabi' },
  { code: 'qu', label: 'Quechua' },
  { code: 'ro', label: 'Romanian' },
  { code: 'rm', label: 'Romansh' },
  { code: 'ru', label: 'Russian' },
  { code: 'sr', label: 'Serbian' },
  { code: 'sd', label: 'Sindhi' },
  { code: 'si', label: 'Sinhala' },
  { code: 'sk', label: 'Slovak' },
  { code: 'sl', label: 'Slovenian' },
  { code: 'so', label: 'Somali' },
  { code: 'st', label: 'Southern Sotho' },
  { code: 'es', label: 'Spanish' },
  { code: 'sw', label: 'Swahili' },
  { code: 'sv', label: 'Swedish' },
  { code: 'tg', label: 'Tajik' },
  { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },
  { code: 'th', label: 'Thai' },
  { code: 'tn', label: 'Tswana' },
  { code: 'tr', label: 'Turkish' },
  { code: 'tk', label: 'Turkmen' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'ur', label: 'Urdu' },
  { code: 'uz', label: 'Uzbek' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'cy', label: 'Welsh' },
  { code: 'fy', label: 'Western Frisian' },
  { code: 'wo', label: 'Wolof' },
  { code: 'yo', label: 'Yoruba' },
  { code: 'zu', label: 'Zulu' },
];

/**
 * Gemini live models.
 *
 * `matches` is a substring test rather than an id list so the preview models can
 * be rolled forward (`gemini-3.1-flash-live-preview` →
 * `gemini-3.5-live-translate-preview`, `…-native-audio-preview-*`) without this
 * file needing an edit each time.
 *
 * On `defaultVoiceId`: Gemini does not document a default prebuilt voice for the
 * Live API, and Willow currently sends no `speechConfig` at all, so today's voice
 * is whatever the service picks. Rather than display a voice that might not be
 * the one speaking, the panel selects the first roster entry and sends it
 * explicitly from the first session onward — the displayed name is then always
 * the voice in use. That is the one behavioural change this file introduces; the
 * language default is `AUTO_LANGUAGE`, which sends no directive and so leaves
 * today's behaviour exactly as it is.
 */
export const GEMINI_VOICE_PROVIDER: VoiceProvider = {
  id: 'gemini-live',
  label: 'Gemini Live',
  matches: (modelId) => modelId.includes('gemini') && modelId.includes('live'),
  // The one model live mode opens a socket with today. `matches` above stays the
  // broader test, so a second Gemini live model only has to be added here.
  models: [{ id: LIVE_MODEL_ID, name: 'Gemini 3.1 Flash Live' }],
  voices: GEMINI_VOICES,
  languages: GEMINI_LANGUAGES,
  languageMode: 'systemInstruction',
  defaultVoiceId: GEMINI_VOICES[0].id,
  defaultLanguageCode: AUTO_LANGUAGE,
};

/**
 * Every provider Willow knows about, most specific first. A future non-Gemini
 * live model is added here and picks up the whole panel — carousel, dots,
 * arrows, language row, persistence — with no component change.
 */
export const VOICE_PROVIDERS: VoiceProvider[] = [GEMINI_VOICE_PROVIDER];

/** The provider serving `modelId`, or null when none claims it. */
export function findVoiceProvider(modelId: string): VoiceProvider | null {
  return VOICE_PROVIDERS.find((p) => p.matches(modelId)) ?? null;
}

/**
 * Every live model Willow can run, across all providers, in registry order.
 *
 * This is what the composer's picker lists while voice mode is active. It is
 * derived rather than a second list, so a provider added to VOICE_PROVIDERS
 * appears in the picker with no change here or in the composer.
 */
export function listVoiceModels(): VoiceModelListing[] {
  return VOICE_PROVIDERS.flatMap((p) =>
    p.models.map((m) => ({ ...m, providerId: p.id, providerLabel: p.label })),
  );
}

/**
 * The live model a session should open with, given a stored preference.
 *
 * Falls back to the first registered model, so a preference left behind by a
 * build that had a model this one does not can never put an unrunnable id on
 * the wire.
 */
export function resolveVoiceModelId(modelId: string | undefined): string {
  const models = listVoiceModels();
  return models.find((m) => m.id === modelId)?.id ?? models[0].id;
}

/** The named voice, falling back to the provider's default then its first. */
export function resolveVoice(provider: VoiceProvider, voiceId: string | undefined): VoiceOption {
  return (
    provider.voices.find((v) => v.id === voiceId) ??
    provider.voices.find((v) => v.id === provider.defaultVoiceId) ??
    provider.voices[0]
  );
}

/** The named language, falling back to the provider's default then its first. */
export function resolveLanguage(
  provider: VoiceProvider,
  code: string | undefined,
): LanguageOption {
  return (
    provider.languages.find((l) => l.code === code) ??
    provider.languages.find((l) => l.code === provider.defaultLanguageCode) ??
    provider.languages[0]
  );
}

/**
 * The sentence appended to the system prompt for a `systemInstruction`-mode
 * provider. Empty for Auto-detect, which is the whole point of that row: no
 * directive means the model keeps choosing for itself.
 */
export function buildLanguageDirective(language: LanguageOption): string {
  if (language.code === AUTO_LANGUAGE) return '';
  return `Speak and respond in ${language.label} (${language.code}) regardless of the language the user speaks in, unless the user explicitly asks you to switch languages.`;
}


