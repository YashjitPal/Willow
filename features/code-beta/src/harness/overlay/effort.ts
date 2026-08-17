/**
 * Reasoning effort, on Codex's own ladder.
 *
 * Effort is part of the harness, not the model: upstream carries it as
 * `model_reasoning_effort` in its config and sends it with every request. Its
 * `ReasoningEffort` enum, verified against
 * `codex-rs/protocol/src/openai_models.rs`, is:
 *
 *     None, Minimal, Low, Medium (default), High, XHigh, Max, Ultra
 *
 * Willow's own scale (`platform/ai/src/models/efforts.ts`) is numeric 0–6 and
 * stops at "Pro". Code Beta maps onto Codex's names instead, which is the whole
 * point of running Codex's harness — including **Ultra**, the top rung, which
 * Willow has no equivalent for.
 *
 * ## The honest caveat
 *
 * Whether a provider *honours* a given effort is model-dependent. `ultra` is
 * accepted by the newest OpenAI reasoning models; most others top out lower and
 * will clamp or reject it. `resolveEffort` therefore returns both the requested
 * level and what Willow will actually send, so the UI can say so rather than
 * quietly implying a level that never took effect.
 */

export type CodexEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'ultra';

export const CODEX_EFFORTS: CodexEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
];

export const EFFORT_LABEL: Record<CodexEffort, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
  ultra: 'Ultra',
};

export const EFFORT_HINT: Record<CodexEffort, string> = {
  none: 'No reasoning. Fastest, and wrong on anything non-trivial.',
  minimal: 'Barely thinks. Renames, one-line copy changes.',
  low: 'Quick decisions. Small, well-specified edits.',
  medium: 'The default. Balanced for most feature work.',
  high: 'Plans before acting. Multi-file changes and debugging.',
  xhigh: 'Long runs. Deep refactors and reviews where latency is worth it.',
  max: 'Exhaustive. Verifies its own work before answering.',
  ultra: 'The ceiling. Slowest by a wide margin; use it when nothing else has worked.',
};

/**
 * Willow persists effort as a number, so Code Beta has to round-trip through
 * one. This is the mapping, and it is deliberately not a straight index:
 * Willow's 0 means "no thinking" and its 6 is the top of its own scale, so the
 * two ends are pinned and the middle follows Codex's order.
 */
const LEVEL_TO_EFFORT: Record<number, CodexEffort> = {
  0: 'none',
  1: 'low',
  2: 'medium',
  3: 'high',
  4: 'xhigh',
  5: 'max',
  6: 'ultra',
};

const EFFORT_TO_LEVEL: Record<CodexEffort, number> = {
  none: 0,
  minimal: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
  ultra: 6,
};

export const effortToLevel = (effort: CodexEffort): number => EFFORT_TO_LEVEL[effort];

export const levelToEffort = (level: number | undefined): CodexEffort =>
  LEVEL_TO_EFFORT[Math.max(0, Math.min(6, Number(level ?? 2)))] ?? 'medium';

/**
 * Which efforts a given model can actually be asked for.
 *
 * Offering a level the provider silently clamps is worse than not offering it —
 * the user believes they raised the effort and nothing changed. The rules below
 * mirror what `platform/ai/src/chat.ts` really sends.
 */
export function supportedEfforts(model: {
  providerId?: string;
  modelId?: string;
  name?: string;
}): CodexEffort[] {
  const provider = String(model.providerId ?? '').toLowerCase();
  const identity = `${model.modelId ?? ''} ${model.name ?? ''}`.toLowerCase();

  // Only the newest OpenAI reasoning models accept the top of the ladder.
  const isFrontierOpenAI =
    (provider.includes('openai') || identity.includes('gpt')) &&
    /gpt-5|codex|o[34]/.test(identity);

  if (isFrontierOpenAI) {
    return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  }
  if (provider.includes('openai') || identity.includes('gpt')) {
    return ['none', 'low', 'medium', 'high'];
  }
  // Gemini Pro cannot turn thinking off; flash can.
  if (provider.includes('gemini') || identity.includes('gemini')) {
    return identity.includes('pro')
      ? ['low', 'medium', 'high']
      : ['none', 'low', 'medium', 'high'];
  }
  if (provider.includes('anthropic') || identity.includes('claude')) {
    return ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
  }
  return ['none', 'low', 'medium', 'high'];
}

export interface ResolvedEffort {
  /** What the user asked for. */
  requested: CodexEffort;
  /** What will actually be sent, after clamping to what the model supports. */
  effective: CodexEffort;
  /** Numeric level for Willow's request layer. */
  level: number;
  /** True when the request had to be lowered. */
  clamped: boolean;
}

export function resolveEffort(
  requested: CodexEffort,
  model: { providerId?: string; modelId?: string; name?: string },
): ResolvedEffort {
  const supported = supportedEfforts(model);
  if (supported.includes(requested)) {
    return { requested, effective: requested, level: effortToLevel(requested), clamped: false };
  }

  // Fall to the highest supported rung at or below the request, so asking for
  // more never accidentally yields less than the next level down.
  const wanted = CODEX_EFFORTS.indexOf(requested);
  let effective = supported[0] ?? 'medium';
  for (const candidate of supported) {
    if (CODEX_EFFORTS.indexOf(candidate) <= wanted) effective = candidate;
  }

  return { requested, effective, level: effortToLevel(effective), clamped: true };
}
