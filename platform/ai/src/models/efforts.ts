export interface ModelEffortRecord {
  id: string;
  name: string;
  modelId?: string;
  provider?: string;
  thinkingLevel?: number;
  thinkingLabel?: string;
  effortLabel?: string;
  [key: string]: unknown;
}

export const getModelGroupKey = (model: ModelEffortRecord) =>
  `${model.provider || 'AI'}::${model.modelId || model.name}::${String(model.profileId || '')}`;

/**
 * Identity text for capability matching: `modelId` plus `name`.
 *
 * `id` is deliberately excluded — it is a storage key (`saved-flash`, or
 * `<baseId>::effort-3` as built by ModelsMenu), so including it would shadow
 * `name` on records that carry no modelId and make every match fail.
 */
const identityOf = (model: ModelEffortRecord) =>
  `${model.modelId || ''} ${model.name || ''}`.toLowerCase();

/**
 * A Gemini flash or flash-lite model, whose no-thinking floor Gemini names
 * `minimal`. Scoped to Gemini deliberately: `glm-4-flash` also contains "flash"
 * but is an OpenAI-compatible model whose level 0 really is `'none'`.
 */
export const isGeminiFlashFamily = (model: ModelEffortRecord): boolean => {
  const provider = String(model.provider || '').toLowerCase();
  const identity = identityOf(model);
  const isGoogle = provider.includes('google') || provider.includes('gemini') || identity.includes('gemini');
  return isGoogle && identity.includes('flash');
};

/**
 * Whether a model can run with reasoning switched off entirely (effort level 0).
 *
 * This mirrors what the request layer in platform/ai/src/chat.ts actually sends,
 * because that is the only thing that decides whether "off" is real:
 *
 *  - Gemini flash / flash-lite: level 0 generally maps to `'minimal'`, Gemini's
 *    no-thinking mode. Gemini 3.7 Flash is the model-specific exception and
 *    starts at Low. Other Flash models label level 0 "Minimal" rather than
 *    "None" because that is the level's own name — see getThinkingEffortLabel.
 *  - Gemini Pro: `pro31Map` and `proMap` have no entry for 0, so a 0 would fall
 *    back to `'high'` — asking for none would silently still think. NOT supported.
 *  - OpenAI / GPT: `reasoningEffortMap[0]` is `'none'`. Supported.
 *  - OpenAI-compatible (Zhipu/GLM, Kimi): `compatibleReasoningEffortMap[0]` is
 *    `'none'`. Supported.
 *  - Grok 4.6: `grokReasoningEffortMap` starts at 1 and defaults to `'high'`.
 *    NOT supported — matches `hasNone: false` in the settings catalog.
 *  - Anthropic / Claude: the Messages call sends no thinking parameter at all,
 *    so level 0 is accepted and nothing is requested. Supported.
 *
 * Defaults to `false` for anything unrecognised: offering a "None" that the API
 * quietly upgrades back to full thinking would be worse than not offering it.
 */
export const modelSupportsNoThinking = (model: ModelEffortRecord): boolean => {
  const provider = String(model.provider || '').toLowerCase();
  const identity = identityOf(model);

  // Gemini Pro cannot turn thinking off — check before the generic gemini rule.
  const isGoogle = provider.includes('google') || provider.includes('gemini') || identity.includes('gemini');
  if (isGoogle && identity.includes('pro')) return false;
  // Gemini 3.7 Flash does not expose the shared Flash "Minimal" picker entry.
  // Keep this model-specific; other Flash generations retain their level-0
  // `minimal` mapping.
  if (isGoogle && identity.includes('gemini-3.7-flash')) return false;
  if (identity.includes('grok')) return false;

  if (identity.includes('flash')) return true;
  if (provider.includes('openai') || identity.includes('gpt')) return true;
  if (provider.includes('anthropic') || identity.includes('claude')) return true;
  if (provider.includes('moonshot') || identity.includes('kimi')) return true;
  if (provider.includes('zhipu') || identity.includes('glm')) return true;

  return false;
};

/**
 * Whether an effort selection means "don't think".
 *
 * Callers use this to decide whether to append the effort to a model pill, so
 * that "Opus 5 None" renders as just "Opus 5".
 *
 * Level 0 is the canonical case and is checked first. Gemini flash maps level 0
 * to `'minimal'`, which is why minimal needs no separate handling — it *is*
 * level 0 for those models.
 *
 * The label is consulted only when no level is present at all. It cannot be
 * trusted alongside a level, because callers build these records by spreading a
 * saved model and overriding just the level — a model persisted at level 0 with
 * `thinkingLabel: 'None'` and then switched to effort 3 still carries the stale
 * `'None'`, and honouring it would wrongly hide a real effort.
 */
export const isNonThinkingEffort = (model: ModelEffortRecord): boolean => {
  if (model.thinkingLevel !== undefined && model.thinkingLevel !== null) {
    return Number(model.thinkingLevel) === 0;
  }
  const label = String(model.thinkingLabel || model.effortLabel || '').trim().toLowerCase();
  if (!label) return true; // no level and no label means nothing was chosen
  return label.startsWith('none') || label === 'minimal' || label === 'non thinking' || label === 'non-thinking';
};

export const sortModelEfforts = <T extends ModelEffortRecord>(models: T[]) =>
  [...models].sort((a, b) => Number(a.thinkingLevel || 0) - Number(b.thinkingLevel || 0));

const GENERIC_EFFORT_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Low',
  2: 'Medium',
  3: 'High',
  4: 'Extra High',
  5: 'Max',
  6: 'Pro',
};

export const getThinkingEffortLabel = (model: ModelEffortRecord, shorten = false) => {
  const level = Number(model.thinkingLevel || 0);
  const provider = String(model.provider || '').toLowerCase();
  const modelId = String(model.modelId || model.name || '').toLowerCase();
  const customEffort = Array.isArray(model.reasoningEfforts)
    ? (model.reasoningEfforts as Array<{ level?: number; label?: string }>).find((effort) => Number(effort.level) === level)
    : undefined;
  if (customEffort?.label) return customEffort.label;

  // Gemini flash / flash-lite call their floor "minimal", not "none" — that is
  // the literal value chat.ts sends (`flashMap[0] = 'minimal'`). Keep that name:
  // it is already the model's no-thinking mode, so labelling it "None" would be
  // renaming an existing level rather than describing it. Scoped to Gemini so a
  // non-Gemini model with "flash" in its id (glm-4-flash) keeps the generic
  // "None", which is what its own mapping sends.
  if (level === 0 && isGeminiFlashFamily(model)) return 'Minimal';

  // These fallbacks cover saved presets created before exact labels were persisted.
  // Level 0 never reaches here — the flash-family check above claims it first.
  if (modelId.includes('gemini-2.5-flash-lite')) {
    return ({ 1: '8k Tokens', 2: '16k Tokens', 3: '24k Tokens' } as Record<number, string>)[level]
      || `Level ${level}`;
  }
  if (modelId.includes('kimi-k2.7-code')) {
    return ({ 0: 'None', 1: 'Fast', 2: 'Deep' } as Record<number, string>)[level]
      || `Level ${level}`;
  }
  if (provider.includes('openai') || modelId.includes('gpt')) {
    if (level === 4) return shorten ? 'xHigh' : 'Extra High';
    if (level === 5) return 'Max';
    if (level === 6) return 'Pro';
  }
  if (provider.includes('anthropic') || modelId.includes('claude')) {
    if (level === 4) return shorten ? 'xHigh' : 'Extra High';
    if (level === 5) return 'Max';
  }

  const defaultLabel = GENERIC_EFFORT_LABELS[level] || `Level ${level}`;
  if (defaultLabel === 'Extra High' && shorten) {
    return 'xHigh';
  }
  return defaultLabel;
};
