/*
 * The model catalogue Models & API offers, and the pricing table it labels it
 * with.
 *
 * Shared because there are two surfaces now: the modal's `ModelsTab` and the
 * standalone `/models-settings` page. A model added on one has to be the same
 * record as a model added on the other — same id, same thinking level, same
 * reasoning efforts — because both write into the one `modelConfig` the composer
 * reads. Duplicating these lists per surface would let them drift.
 */

import { type ProviderId } from '@willow/ai/providers/endpoints';
import { nativeToolFormatForProvider, type ProviderApiFormat } from '@willow/ai/providers/profiles';

export interface ProviderReasoningEffortOption {
  id: string;
  level: number;
  label: string;
  value?: string;
}

export interface ProviderModelOption {
  id: string;
  name: string;
  maxLevels: number;
  hasNone: boolean;
  noneLabel?: string;
  levelLabels?: Record<number, string>;
  reasoningEfforts?: ProviderReasoningEffortOption[];
  capabilities?: string[];
}

export interface ProviderDescriptor {
  id: ProviderId;
  /** Title on the provider row and in the "Manage …" heading. */
  name: string;
  /** Short attribution under a saved model's name. */
  vendor: string;
}

export const PROVIDERS: ProviderDescriptor[] = [
  { id: 'gemini', name: 'Google Gemini', vendor: 'Google' },
  { id: 'openai', name: 'OpenAI', vendor: 'OpenAI' },
  { id: 'anthropic', name: 'Anthropic', vendor: 'Anthropic' },
  { id: 'moonshot', name: 'Moonshot AI', vendor: 'Moonshot AI' },
  { id: 'spacexai', name: 'SpaceXAI', vendor: 'SpaceXAI' },
  { id: 'zhipuai', name: 'Zhipu AI', vendor: 'Zhipu AI' },
];

export const providerName = (provider: ProviderId): string =>
  PROVIDERS.find((candidate) => candidate.id === provider)?.name || provider;

export const providerVendor = (provider: ProviderId): string =>
  PROVIDERS.find((candidate) => candidate.id === provider)?.vendor || provider;

/**
 * What the API format and Tool translation pair actually does, in a sentence.
 *
 * Shared by both Models & API surfaces, like the roster above and for the same
 * reason. Together those two dropdowns decide whether a turn is sent the
 * provider's own server-side tools or Willow's client-side substitute, and that is
 * not guessable from three words in a menu — the distinction only bites once
 * someone points a provider at a gateway, which is exactly when they most need to
 * know. `nativeToolFormatForProvider` is the same predicate the request layer
 * gates on, so the sentence cannot drift from the behaviour.
 */
export const toolPolicyHint = (
  provider: ProviderId,
  format: ProviderApiFormat,
  policy: string,
  hasSearchBackend: boolean,
): string => {
  if (policy === 'disabled') {
    return 'No tools are sent. This model cannot search the web, use Canvas, or reach your connected apps.';
  }
  const backend = hasSearchBackend
    ? 'Willow runs the search itself, through your Gemini key.'
    : 'Add a Gemini key to give it a search tool Willow can answer.';
  if (policy === 'function-calling') {
    return `Built-in tools are withheld and only plain function calls are sent — the right choice for a gateway that proxies the wire format but not the provider's own tools. ${backend}`;
  }
  if (!nativeToolFormatForProvider(provider, format)) {
    return `This format has no verified built-in search for ${providerName(provider)}, so none is sent. ${backend}`;
  }
  return `${providerName(provider)}'s own built-in tools are sent with each request. If this endpoint is a gateway that does not implement them, switch to Function calling.`;
};

export const STANDARD_THINKING_LABELS: Record<number, string> = {
  1: 'Low',
  2: 'Medium',
  3: 'High',
};

export const getConfiguredThinkingLabel = (
  level: number,
  levelLabels: Record<number, string> = STANDARD_THINKING_LABELS,
  noneLabel = 'None',
) => level === 0 ? noneLabel : levelLabels[level] || `Level ${level}`;

export const DEFAULT_CUSTOM_REASONING_EFFORTS = [
  { id: 'effort-none', level: '0', label: 'None', value: 'none' },
  { id: 'effort-low', level: '1', label: 'Low', value: 'low' },
  { id: 'effort-medium', level: '2', label: 'Medium', value: 'medium' },
  { id: 'effort-high', level: '3', label: 'High', value: 'high' },
];

export const GEMINI_MODELS: ProviderModelOption[] = [
  {
    id: 'gemini-embedding-2',
    name: 'Gemini Embedding 2',
    maxLevels: 0,
    hasNone: true,
    noneLabel: 'None',
    capabilities: ['embedding'],
  },
  /*
   * Not announced. The WSJ reported on 2026-09-02 that Google was readying it
   * for release "as soon as Wednesday" under the internal name Skimaki, and
   * Business Insider had it in employee preview from 2026-08-27. Google has
   * published no model page, no slug and no pricing, so the id, the display
   * name and the price below are all inferred from 3.7 Flash — the previous
   * three Flash releases have used `gemini-<major>.<minor>-flash` without
   * exception. Confirm all four against Google's docs once it is live.
   */
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    maxLevels: 3,
    hasNone: false,
    levelLabels: { 1: 'Low', 2: 'Medium', 3: 'High' },
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    maxLevels: 3,
    hasNone: false,
    levelLabels: { 1: 'Low', 2: 'Medium', 3: 'High' },
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    maxLevels: 3,
    hasNone: true,
    noneLabel: 'None',
    levelLabels: { 1: 'Low', 2: 'Medium', 3: 'High' },
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    maxLevels: 3,
    hasNone: true,
    noneLabel: 'None',
    levelLabels: { 1: 'Low', 2: 'Medium', 3: 'High' },
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash Lite',
    maxLevels: 3,
    hasNone: true,
    noneLabel: 'None',
    levelLabels: { 1: 'Low', 2: 'Medium', 3: 'High' },
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    maxLevels: 3,
    hasNone: false,
    levelLabels: { 1: 'Low', 2: 'Medium', 3: 'High' },
  },
  {
    id: 'gemma-4-26b-a4b-it',
    name: 'Gemma 4 26B A4B IT',
    maxLevels: 1,
    hasNone: true,
    noneLabel: 'Minimal',
    levelLabels: { 1: 'High' },
    reasoningEfforts: [
      { id: 'gemma-4-26b-a4b-it-effort-0', level: 0, label: 'Minimal', value: 'minimal' },
      { id: 'gemma-4-26b-a4b-it-effort-1', level: 1, label: 'High', value: 'high' },
    ],
  },
  {
    id: 'gemma-4-31b-it',
    name: 'Gemma 4 31B IT',
    maxLevels: 1,
    hasNone: true,
    noneLabel: 'Minimal',
    levelLabels: { 1: 'High' },
    reasoningEfforts: [
      { id: 'gemma-4-31b-it-effort-0', level: 0, label: 'Minimal', value: 'minimal' },
      { id: 'gemma-4-31b-it-effort-1', level: 1, label: 'High', value: 'high' },
    ],
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash Lite',
    maxLevels: 3,
    hasNone: true,
    noneLabel: 'None (Disabled)',
    levelLabels: { 1: '8k Tokens', 2: '16k Tokens', 3: '24k Tokens' },
  },
  { id: 'gemini-3-pro-image-preview', name: 'Nano Banana Pro', maxLevels: 0, hasNone: true, noneLabel: 'None' },
  { id: 'gemini-3.1-flash-image-preview', name: 'Nano Banana 2', maxLevels: 0, hasNone: true, noneLabel: 'None' },
  { id: 'gemini-3.1-flash-lite-image', name: 'Nano Banana Lite', maxLevels: 0, hasNone: true, noneLabel: 'None' },
  { id: 'omni-flash', name: 'Gemini Omni Flash 1', maxLevels: 0, hasNone: true, noneLabel: 'None' },
  { id: 'omni-flash-1.1', name: 'Gemini Omni Flash 1.1', maxLevels: 0, hasNone: true, noneLabel: 'None' },
  { id: 'lyria-3-pro', name: 'Lyria 3 Pro', maxLevels: 0, hasNone: true, noneLabel: 'None' },
  { id: 'lyria-3', name: 'Lyria 3', maxLevels: 0, hasNone: true, noneLabel: 'None' },
  { id: 'veo-3.1-fast', name: 'Veo 3.1 Fast', maxLevels: 0, hasNone: true, noneLabel: 'None' },
  { id: 'veo-3.1', name: 'Veo 3.1', maxLevels: 0, hasNone: true, noneLabel: 'None' },
  { id: 'veo-3.1-lite', name: 'Veo 3.1 Lite', maxLevels: 0, hasNone: true, noneLabel: 'None' },
  { id: 'gemini-3.1-flash-live-preview', name: 'Gemini 3.1 Flash Live', maxLevels: 0, hasNone: true, noneLabel: 'None' },
  {
    id: 'gemini-3.5-transcribe',
    name: 'Gemini 3.5 Transcribe',
    maxLevels: 0,
    hasNone: true,
    noneLabel: 'None',
    capabilities: ['audio'],
  },
  {
    id: 'gemini-3.5-transcribe-live',
    name: 'Gemini 3.5 Transcribe Live',
    maxLevels: 0,
    hasNone: true,
    noneLabel: 'None',
    capabilities: ['audio'],
  },
];

export const OPENAI_MODELS: ProviderModelOption[] = [
  { id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol', maxLevels: 3, hasNone: false },
  { id: 'gpt-5.6-terra', name: 'GPT 5.6 Terra', maxLevels: 3, hasNone: false },
  { id: 'gpt-5.6-luna', name: 'GPT 5.6 Luna', maxLevels: 3, hasNone: false },
  { id: 'gpt-image-2', name: 'GPT Image 2', maxLevels: 3, hasNone: false },
];

export const ANTHROPIC_MODELS: ProviderModelOption[] = [
  { id: 'claude-opus-5', name: 'Claude Opus 5', maxLevels: 3, hasNone: false },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', maxLevels: 3, hasNone: false },
  { id: 'claude-fable-5', name: 'Claude Fable 5', maxLevels: 3, hasNone: false },
];

export const MOONSHOT_MODELS: ProviderModelOption[] = [
  {
    id: 'kimi-k3',
    name: 'Kimi K3',
    maxLevels: 4,
    hasNone: true,
    levelLabels: { 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Max' },
  },
];

export const SPACEXAI_MODELS: Array<ProviderModelOption & { defaultThinkingLevel: number }> = [
  {
    id: 'grok-4.6',
    name: 'Grok 4.6',
    maxLevels: 3,
    hasNone: false,
    defaultThinkingLevel: 3,
    levelLabels: { 1: 'Low', 2: 'Medium', 3: 'High' },
  },
  { id: 'grok-voice', name: 'Grok Voice', maxLevels: 0, hasNone: true, defaultThinkingLevel: 0 },
  { id: 'grok-imagine', name: 'Grok Imagine', maxLevels: 0, hasNone: true, defaultThinkingLevel: 0 },
];

export const ZHIPUAI_MODELS: ProviderModelOption[] = [
  { id: 'glm-5.2', name: 'GLM 5.2', maxLevels: 3, hasNone: false },
  { id: 'glm-5.3', name: 'GLM 5.3', maxLevels: 3, hasNone: false },
];

export const PROVIDER_MODEL_OPTIONS: Record<ProviderId, ProviderModelOption[]> = {
  gemini: GEMINI_MODELS,
  openai: OPENAI_MODELS,
  anthropic: ANTHROPIC_MODELS,
  moonshot: MOONSHOT_MODELS,
  spacexai: SPACEXAI_MODELS,
  zhipuai: ZHIPUAI_MODELS,
};

/**
 * What the provider charges, as one short string for the catalogue pill.
 *
 * Two shapes, because the providers bill in two shapes:
 *  - `$in/$out` — USD per 1M input / output tokens, the usual case.
 *  - `$n/unit`  — a per-generation rate, for models not billed per token at
 *    all. Veo bills per video, Lyria per clip, Grok Voice per minute. These
 *    used to carry invented token pairs, which read as authoritative on
 *    screen and were not even in the right unit.
 *
 * Every figure is the provider's own published list price, checked 2026-09-02.
 * Output rates include reasoning tokens where the provider bills them that
 * way. Where a provider publishes tiers — long context, batch, cached input,
 * higher-resolution image output — this is the standard short-context
 * non-batch rate, because the pill has room for one number and that is the one
 * a user is charged by default.
 *
 * An unlisted model returns an empty string rather than a provider-typical
 * guess: a guess is indistinguishable from a real price on screen, and a
 * user-added custom model has no price we could know. That fallback is what
 * quietly labelled every GPT-5.6 model $2.50/$10.00.
 */
const MODEL_PRICES: Record<string, string> = {
  // ── Gemini ────────────────────────────────────────────────────────────────
  // Output is not charged, so a pair would read "$0.20/$0.00".
  'gemini-embedding-2': '$0.20/free',
  /*
   * 3.8, 3.7 and 3.6 Flash share one introductory rate that runs to
   * 2026-12-31; all three go to $1.50/$7.50 on 2027-01-01. Worth revisiting in
   * January rather than letting the pill under-report by half.
   */
  'gemini-3.8-flash': '$0.75/$3.75',
  'gemini-3.7-flash': '$0.75/$3.75',
  'gemini-3.6-flash': '$0.75/$3.75',
  'gemini-3.5-flash': '$1.50/$9.00',
  'gemini-3.5-flash-lite': '$0.30/$2.50',
  'gemini-3.1-pro-preview': '$2.00/$12.00',
  // Apache 2.0 open weights. The Gemini API serves Gemma on the free tier
  // only and lists no paid rate at all.
  'gemma-4-26b-a4b-it': 'Free',
  'gemma-4-31b-it': 'Free',
  'gemini-2.5-flash-lite': '$0.10/$0.40',
  /*
   * Image models bill image *output* tokens, which Google converts for you:
   * 1290 tokens per 1024px image at $30.00/1M. Per image is the unit its own
   * docs headline and the one anybody budgets in.
   */
  'gemini-3-pro-image-preview': '$0.04/image',
  'gemini-3.1-flash-image-preview': '$0.04/image',
  'gemini-3.1-flash-lite-image': '$0.03/image',
  // Video output, billed at 5,792 tokens per second of 720p — about $0.10/sec.
  'omni-flash': '$1.50/$17.50',
  'omni-flash-1.1': '$1.50/$17.50',
  'lyria-3-pro': '$0.08/song',
  'lyria-3': '$0.04/clip',
  'veo-3.1': '$0.40/video',
  'veo-3.1-fast': '$0.10/video',
  'veo-3.1-lite': '$0.05/video',
  // Text rate. Audio, the mode this model exists for, is $3.00/$12.00.
  'gemini-3.1-flash-live-preview': '$0.75/$4.50',
  'gemini-3.5-transcribe': '$2.50/$12.00',
  'gemini-3.5-transcribe-live': '$3.50/$21.00',

  // ── OpenAI ────────────────────────────────────────────────────────────────
  // Sol is on a promotional rate at least to 2026-11-21; list is $5.00/$30.00.
  'gpt-5.6-sol': '$4.00/$20.00',
  'gpt-5.6-terra': '$2.00/$12.00',
  'gpt-5.6-luna': '$0.20/$1.20',
  // Text input against image output. Image *input*, for edits, is $8.00.
  'gpt-image-2': '$5.00/$30.00',

  // ── Anthropic ─────────────────────────────────────────────────────────────
  'claude-opus-5': '$5.00/$25.00',
  'claude-sonnet-5': '$2.00/$10.00',
  // Fable is Anthropic's dearest self-serve tier, not a small cheap model.
  'claude-fable-5': '$10.00/$50.00',
  // Not in the catalogue, but it is the shipped `systemDefaults.computerUse`.
  'claude-sonnet-4.5': '$3.00/$15.00',

  // ── Moonshot ──────────────────────────────────────────────────────────────
  'kimi-k3': '$3.00/$15.00',

  // ── xAI ───────────────────────────────────────────────────────────────────
  'grok-4.6': '$2.00/$6.00',
  'grok-voice': '$0.08/min',
  'grok-imagine': '$0.04/image',

  // ── Zhipu ─────────────────────────────────────────────────────────────────
  'glm-5.2': '$1.40/$4.40',
  // Announced, but Z.AI has not published a pay-as-you-go rate for it yet.
  'glm-5.3': '',
};

export const getModelPricing = (modelId: string, _provider?: string): string =>
  MODEL_PRICES[modelId] || '';

const titleCaseModelId = (modelId: string) =>
  modelId.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

/**
 * The record "Add to Models" appends to `modelConfig[provider].savedModels`.
 *
 * The per-provider differences are real and load-bearing, not tidy-up debt:
 * Gemini carries a full thinking scale (and sometimes explicit reasoning
 * efforts) read off its catalogue entry, GLM 5.3 has its own three-step effort
 * ladder, and the rest have no published scale so they save at the top level.
 * This mirrors what the modal's `ModelsTab` writes, field for field.
 */
export const buildSavedModel = (provider: ProviderId, modelId: string): Record<string, unknown> | null => {
  const option = PROVIDER_MODEL_OPTIONS[provider]?.find((candidate) => candidate.id === modelId);
  const id = Math.random().toString(36).substr(2, 9);

  if (provider === 'gemini') {
    if (!option) return null;
    const thinkingLabel = getConfiguredThinkingLabel(option.maxLevels, option.levelLabels, option.noneLabel);
    return {
      id,
      modelId: option.id,
      name: option.name,
      thinkingLevel: option.maxLevels,
      thinkingLabel,
      ...(option.reasoningEfforts
        ? { reasoningEfforts: option.reasoningEfforts, effortLabel: thinkingLabel }
        : {}),
      capabilities: option.capabilities,
    };
  }

  if (provider === 'zhipuai') {
    const reasoningEfforts = modelId === 'glm-5.3'
      ? [
          { id: `${modelId}-effort-1`, level: 1, label: 'Low', value: 'low' },
          { id: `${modelId}-effort-2`, level: 2, label: 'High', value: 'high' },
          { id: `${modelId}-effort-3`, level: 3, label: 'Max', value: 'max' },
        ]
      : undefined;
    return {
      id,
      modelId,
      name: option?.name || (modelId === 'glm-5.3' ? 'GLM 5.3' : 'GLM 5.2'),
      thinkingLevel: 3,
      thinkingLabel: modelId === 'glm-5.3' ? 'Max' : 'High',
      ...(reasoningEfforts ? { reasoningEfforts, effortLabel: 'Max' } : {}),
    };
  }

  // OpenAI and Anthropic title-case an unlisted id; Moonshot and SpaceXAI show
  // it raw. Both are what the modal does today.
  const fallbackName = provider === 'openai' || provider === 'anthropic'
    ? titleCaseModelId(modelId)
    : modelId;

  return {
    id,
    modelId,
    name: option?.name || fallbackName,
    thinkingLevel: 3,
    thinkingLabel: 'High',
  };
};
