/**
 * Reasoning effort, on Codex's own ladder.
 *
 * Upstream's `ReasoningEffort`, verified against
 * `codex-rs/protocol/src/openai_models.rs` at the pinned commit:
 *
 *     None, Minimal, Low, Medium (default), High, XHigh, Max, Ultra,
 *     Persistent, Custom(String)
 *
 * Willow's own scale (`platform/ai/src/models/efforts.ts`) is numeric 0–6 and
 * stops at "Pro". The harness uses Codex's names instead, which is the point of
 * running Codex's harness.
 *
 * ## What Ultra is, exactly
 *
 * It is easy to assume Ultra means "even more reasoning". It does not, and the
 * two lines of upstream that settle it are worth quoting.
 *
 * `codex-rs/core/src/client.rs`:
 *
 *     fn reasoning_effort_for_request(effort: ReasoningEffortConfig) -> ReasoningEffortConfig {
 *         match effort {
 *             ReasoningEffortConfig::Ultra => ReasoningEffortConfig::Max,
 *             effort => effort,
 *         }
 *     }
 *
 * `codex-rs/core/src/session/multi_agents.rs`:
 *
 *     Some(ReasoningEffort::Ultra) => MultiAgentMode::Proactive,
 *     _ => MultiAgentMode::ExplicitRequestOnly,
 *
 * So: **Ultra is never sent on the wire** — it lowers to `Max`, which is the
 * top of the reasoning scale anyway — and the thing it actually selects is one
 * bit of harness behaviour, proactive sub-agent delegation. See
 * `multi-agent-mode.ts`, which holds upstream's own wording for both states.
 *
 * Two consequences follow, and they are why Ultra is offered on every model:
 * nothing about it depends on the provider, and the reasoning half is already
 * at the ceiling before Ultra is reached.
 *
 * ## Where this file deliberately differs, and why it has to
 *
 * Upstream speaks to exactly one backend, so it can lower Ultra to the literal
 * token `max` unconditionally. Willow speaks to six, and
 * `platform/ai/src/chat.ts` forwards `reasoningEffort` **verbatim** to Gemini as
 * `thinking_level` (line ~1485: `geminiThinkingLevel = options.reasoningEffort.trim()`).
 * Sending `max` there is not a silent downgrade — it is an invalid enum value
 * and the request fails. So the wire value clamps per provider, and `max` is
 * reached only where `max` exists. `supportedEfforts` is that vocabulary, and
 * it is the one place this file is not a transcription.
 */

import {
  multiAgentModeForEffort,
  type MultiAgentMode,
} from './multi-agent-mode';
import { DEFAULT_MAX_CONCURRENT_AGENTS } from './collaboration-tools';

export type CodexEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'ultra'
  /**
   * In upstream's enum, and accepted here so a value round-trips rather than
   * silently becoming `medium`. It is **not** offered in the picker: upstream
   * gives it no client behaviour, no catalog model advertises it, and no preset
   * selects it, so putting it in front of a user would be inventing a feature
   * rather than porting one.
   */
  | 'persistent';

/** The selectable ladder, low to high. Order drives clamping. */
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
  persistent: 'Persistent',
};

export const EFFORT_HINT: Record<CodexEffort, string> = {
  none: 'No reasoning. Fastest, and wrong on anything non-trivial.',
  minimal: 'Barely thinks. Renames, one-line copy changes.',
  low: 'Quick decisions. Small, well-specified edits.',
  medium: 'The default. Balanced for most feature work.',
  high: 'Plans before acting. Multi-file changes and debugging.',
  xhigh: 'Long runs. Deep refactors and reviews where latency is worth it.',
  max: 'Exhaustive. Verifies its own work before answering.',
  ultra: 'Max reasoning, and delegates to sub-agents on its own judgement.',
  persistent: 'A model-defined effort this client does not select.',
};

/**
 * Willow persists effort as a number, so the harness has to round-trip through
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
  // Unknown to Willow's numeric scale; treated as the default rather than as an
  // end of the ladder, matching upstream's `#[default] Medium`.
  persistent: 2,
};

export const effortToLevel = (effort: CodexEffort): number => EFFORT_TO_LEVEL[effort];

export const levelToEffort = (level: number | undefined): CodexEffort =>
  LEVEL_TO_EFFORT[Math.max(0, Math.min(6, Number(level ?? 2)))] ?? 'medium';

/** Upstream's `ReasoningEffort::from_str`, for values arriving from storage. */
export function parseEffort(value: unknown): CodexEffort | null {
  const needle = String(value ?? '').trim().toLowerCase();
  const known: CodexEffort[] = [...CODEX_EFFORTS, 'persistent'];
  return known.find((effort) => effort === needle) ?? null;
}

/**
 * The API-level efforts a model actually accepts.
 *
 * These are real reasoning tokens sent on the wire, so offering one the
 * provider rejects is worse than not offering it. The lists mirror what
 * `platform/ai/src/chat.ts` really sends.
 *
 * **`ultra` is deliberately absent from every list.** It is not a wire value —
 * see the module comment. `supportedEfforts` answers "what can the API be
 * told", and the answer is never "ultra".
 */
export function supportedEfforts(model: {
  providerId?: string;
  modelId?: string;
  name?: string;
}): CodexEffort[] {
  const provider = String(model.providerId ?? '').toLowerCase();
  const identity = `${model.modelId ?? ''} ${model.name ?? ''}`.toLowerCase();

  const isFrontierOpenAI =
    (provider.includes('openai') || identity.includes('gpt')) &&
    /gpt-5|codex|o[34]/.test(identity);

  if (isFrontierOpenAI) {
    return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  }
  if (provider.includes('openai') || identity.includes('gpt')) {
    return ['none', 'low', 'medium', 'high'];
  }
  /*
   * Gemini's `thinking_level` vocabulary is minimal / low / medium / high —
   * there is no `none`, and `chat.ts` forwards whatever it is handed. Its own
   * numeric table maps level 0 to `minimal` for exactly this reason
   * (`flashMap = { 0: 'minimal', … }`), so `minimal` is the floor here too.
   * Offering `none` sent a token Gemini rejects, which surfaced as a failed
   * turn rather than as a quiet downgrade.
   */
  if (provider.includes('gemini') || identity.includes('gemini')) {
    return identity.includes('pro')
      ? ['low', 'medium', 'high']
      : ['minimal', 'low', 'medium', 'high'];
  }
  if (provider.includes('anthropic') || identity.includes('claude')) {
    return ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
  }
  return ['none', 'low', 'medium', 'high'];
}

/**
 * What the user may pick.
 *
 * Every API level the model takes, **plus Ultra on every model** — because
 * Ultra is a harness mode rather than a wire value, so nothing about it depends
 * on the provider. Picking it on Claude sends Claude's own ceiling and turns on
 * proactive delegation, which is exactly what it does upstream.
 */
export function selectableEfforts(model: {
  providerId?: string;
  modelId?: string;
  name?: string;
}): CodexEffort[] {
  return [...supportedEfforts(model), 'ultra'];
}

/* ------------------------------------------------------------------------ */
/* Harness-level effort                                                      */
/* ------------------------------------------------------------------------ */

/**
 * The part of effort that is not a wire parameter.
 *
 * Upstream derives exactly one thing from effort beyond the API value: the
 * multi-agent mode. There is no per-effort guidance text in Codex — the model
 * is not told "work carefully" at high and "be exhaustive" at max, and this
 * file used to invent both. That invention is gone; what upstream sends is a
 * `<multi_agent_mode>` developer fragment and nothing else.
 *
 * `maxIterations` has no upstream counterpart and is not pretending to. Codex
 * runs until the model stops; a browser tab cannot, because a runaway loop
 * there spends the user's tokens with no terminal to interrupt. It is a safety
 * bound scaled to the effort that was asked for, so that `low` fails fast and
 * `ultra` is allowed to actually work.
 */
export interface HarnessEffort {
  /** Tool-call rounds allowed in one turn. Willow's own bound; see above. */
  maxIterations: number;
  /** Upstream's `MultiAgentMode`, derived from effort exactly as it derives it. */
  multiAgentMode: MultiAgentMode;
  /**
   * Agents allowed to run at once.
   *
   * `DEFAULT_MULTI_AGENT_V2_MAX_CONCURRENT_THREADS_PER_SESSION`, which is 4.
   * **The same for every rung**, because upstream is: it is one config value on
   * the session, and effort does not touch it. Ultra changes the *mode*, not
   * the ceiling.
   *
   * This used to scale from 1 at `none` to 4 at `ultra`, which was invented and
   * had a real cost — it made low effort quietly worse at a job the user had
   * asked to be delegated, for no reason upstream would recognise.
   */
  maxConcurrentAgents: number;
}

/** Loop bound per rung. Deliberately the only thing that varies by depth. */
const MAX_ITERATIONS_BY_EFFORT: Record<CodexEffort, number> = {
  none: 3,
  minimal: 3,
  low: 5,
  medium: 8,
  high: 12,
  xhigh: 18,
  max: 24,
  ultra: 32,
  persistent: 8,
};

export const harnessEffort = (effort: CodexEffort): HarnessEffort => ({
  maxIterations: MAX_ITERATIONS_BY_EFFORT[effort],
  multiAgentMode: multiAgentModeForEffort(effort),
  maxConcurrentAgents: DEFAULT_MAX_CONCURRENT_AGENTS,
});

export interface ResolvedEffort {
  /** What the user asked for. Drives harness behaviour on every model. */
  requested: CodexEffort;
  /**
   * What actually goes on the wire. **Never `ultra`** — upstream lowers it to
   * the backend-compatible ceiling, and so does this.
   */
  effective: CodexEffort;
  /** Numeric level for Willow's request layer. */
  level: number;
  /**
   * True when an ordinary API level had to be lowered, which is a real loss.
   * Ultra is *not* a clamp: lowering it on the wire is its designed behaviour,
   * and the mode it selects is delivered in full.
   */
  clamped: boolean;
  /** Loop bound and multi-agent mode, from the request. */
  harness: HarnessEffort;
}

export function resolveEffort(
  requested: CodexEffort,
  model: { providerId?: string; modelId?: string; name?: string },
): ResolvedEffort {
  const supported = supportedEfforts(model);

  // The harness always runs at what was asked for — that half is model-agnostic.
  const harness = harnessEffort(requested);

  /*
   * Ultra, as close to upstream as six providers allow.
   *
   * Upstream lowers it to the literal `max`. Here it lowers to this model's
   * real ceiling, which *is* `max` wherever `max` is a token the provider
   * accepts — every frontier OpenAI model and Anthropic — and `high` on Gemini,
   * whose vocabulary stops there. Either way it is not a clamp and must not be
   * reported as one: reasoning goes as high as the model can go, and the thing
   * Ultra actually selects — proactive delegation — is delivered in full.
   */
  if (requested === 'ultra') {
    const ceiling = supported[supported.length - 1] ?? 'high';
    return {
      requested,
      effective: ceiling,
      level: effortToLevel(ceiling),
      clamped: false,
      harness,
    };
  }

  if (supported.includes(requested)) {
    return {
      requested,
      effective: requested,
      level: effortToLevel(requested),
      clamped: false,
      harness,
    };
  }

  // Fall to the highest supported rung at or below the request, so asking for
  // more never accidentally yields less than the next level down.
  const wanted = CODEX_EFFORTS.indexOf(requested);
  let effective = supported[0] ?? 'medium';
  for (const candidate of supported) {
    if (CODEX_EFFORTS.indexOf(candidate) <= wanted) effective = candidate;
  }

  return { requested, effective, level: effortToLevel(effective), clamped: true, harness };
}
