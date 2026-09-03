/**
 * Reasoning effort, on Codex's own ladder.
 *
 * Upstream's `ReasoningEffort` enum, verified against
 * `codex-rs/protocol/src/openai_models.rs`, is:
 *
 *     None, Minimal, Low, Medium (default), High, XHigh, Max, Ultra
 *
 * Willow's own scale (`platform/ai/src/models/efforts.ts`) is numeric 0–6 and
 * stops at "Pro". Code Beta uses Codex's names instead, which is the point of
 * running Codex's harness.
 *
 * ## Ultra is a mode, not a level
 *
 * This is the part that is easy to get wrong, and it is documented explicitly
 * upstream. From the commit that introduced it (openai/codex #29899):
 *
 *   "Ultra should be one user-facing reasoning selection for work that benefits
 *    from both maximum reasoning and proactive multi-agent delegation… clients
 *    select `ultra`, core derives proactive multi-agent behavior when the turn
 *    is eligible for multi-agent V2, and inference requests continue to use the
 *    backend-compatible `max` value."
 *
 * And from the gating PR (#29709): *"Ultra is a product-level reasoning
 * selection… without introducing a new backend reasoning token. Lower Ultra to
 * `max` at the Responses API boundary."*
 *
 * Two consequences, and both shape this file:
 *
 * 1. **`ultra` is never sent on the wire.** It lowers to the model's real
 *    ceiling. Sending the literal token would be wrong — no backend knows it.
 * 2. **Ultra therefore works on every model.** What it changes is *harness*
 *    behaviour: sub-agent delegation flips from "only when asked" to
 *    proactive. That is Willow's own loop, and it is model-agnostic.
 *
 * So Ultra is offered everywhere, and only the ordinary API levels clamp.
 */

import {
  EXPLICIT_REQUEST_ONLY,
  multiAgentModeForEffort,
  type MultiAgentMode,
} from './multi-agent-mode';

export type CodexEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'ultra';

export type MultiAgentVersion = 'v1' | 'v2';

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
  ultra: 'Max reasoning, and fans work out to sub-agents on its own. Slowest by far.',
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

/*
 * `minimal` maps to 0 alongside `none`, and that is a lossy rung rather than a
 * mistake.
 *
 * Willow persists effort as a number 0-6 with seven slots for Codex's eight
 * rungs, so one pair has to share. `none` and `minimal` are the pair that costs
 * least: both mean "do not think about this", and `LEVEL_TO_EFFORT` resolves 0
 * back to `none`, which is the safer of the two to land on.
 *
 * The consequence worth knowing: **`minimal` cannot survive a round trip
 * through the numeric level.** A caller that needs it must pass the
 * `CodexEffort` through directly rather than via `effortToLevel`.
 */
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
 * The API-level efforts a model actually accepts.
 *
 * These are real reasoning tokens sent on the wire, so offering one the
 * provider silently clamps is worse than not offering it. The rules mirror what
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
  reasoningEfforts?: readonly unknown[];
}): CodexEffort[] {
  const declared = declaredSupportedEfforts(model.reasoningEfforts);
  if (declared.length > 0) return declared;

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

/**
 * Model records created in Settings can carry their own effort roster. Keep
 * the harness vocabulary canonical while accepting the labels/value shapes
 * already used by the model picker. Unknown provider-specific values are
 * ignored so they cannot accidentally be sent as a Codex wire value.
 */
function declaredSupportedEfforts(raw: readonly unknown[] | undefined): CodexEffort[] {
  if (!Array.isArray(raw)) return [];
  const aliases: Record<string, CodexEffort> = {
    none: 'none',
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    'extra high': 'xhigh',
    max: 'max',
  };
  const byLevel: Record<number, CodexEffort> = {
    0: 'none',
    1: 'low',
    2: 'medium',
    3: 'high',
    4: 'xhigh',
    5: 'max',
  };
  const result = new Map<CodexEffort, number>();
  raw.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const value = String((entry as { value?: unknown }).value ?? '').trim().toLowerCase();
    const label = String((entry as { label?: unknown }).label ?? '').trim().toLowerCase();
    const level = Number((entry as { level?: unknown }).level);
    const effort = aliases[value] ?? aliases[label] ?? byLevel[level];
    if (!effort || effort === 'ultra') return;
    result.set(effort, level);
  });
  return [...result.keys()].sort((a, b) => CODEX_EFFORTS.indexOf(a) - CODEX_EFFORTS.indexOf(b));
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
  reasoningEfforts?: readonly unknown[];
  multiAgentVersion?: MultiAgentVersion | string | null;
  supportsMultiAgent?: boolean;
}): CodexEffort[] {
  return [...supportedEfforts(model), 'ultra'];
}

/* ------------------------------------------------------------------------ */
/* Harness-level effort                                                      */
/* ------------------------------------------------------------------------ */

/**
 * Effort is two things, and conflating them is a mistake.
 *
 * **The API parameter** (`reasoning.effort`) is model-dependent. Only some
 * models accept `ultra`; sending it elsewhere is silently downgraded, and on
 * Gemini Pro it lands on `'low'` — the opposite of what was asked. That half
 * has to clamp.
 *
 * **The harness behaviour** is not. Whether it is told to plan before acting,
 * whether it is expected to verify its work — all of that is Willow's own loop
 * and its own prompt, and it works
 * identically on every model. A Claude model told "you are running at ultra
 * effort, plan first and verify with computer_use" genuinely does more work,
 * even though Anthropic's API never receives a reasoning parameter at all.
 *
 * So the requested level drives the harness, and only the clamped level goes on
 * the wire. That is what makes Ultra mean something everywhere.
 */
/**
 * `DEFAULT_MULTI_AGENT_V2_MAX_CONCURRENT_THREADS_PER_SESSION`, which is 4
 * (`codex-rs/core/src/config/mod.rs`).
 *
 * **The same for every rung**, because upstream is: it is one config value on
 * the session, and effort does not touch it. Ultra changes the *mode*, not the
 * ceiling.
 */
export const DEFAULT_MAX_CONCURRENT_AGENTS = 4;

export interface HarnessEffort {
  /**
   * Upstream's `MultiAgentMode`, derived from effort exactly as it derives it.
   *
   * This replaced a `delegation: 'proactive' | 'on-request'` pair and a
   * `guidance` string. The guidance was invented: there is no per-effort
   * guidance text anywhere in `codex-rs` — the model is not told "work
   * carefully" at high and "be exhaustive" at max. What upstream sends is a
   * `<multi_agent_mode>` developer fragment and nothing else.
   */
  multiAgentMode: MultiAgentMode;
  /** Sub-agents allowed to run at once. See the constant above. */
  maxConcurrentAgents: number;
  /**
   * Codex model-catalog protocol selected for collaboration tools.
   *
   * Kept deliberately, and it is the one place Spark is *more* faithful than
   * the Code harness: upstream's `effective_multi_agent_mode` returns `None`
   * when the turn is not eligible for multi-agent V2, so no
   * `<multi_agent_mode>` fragment is sent at all. Upstream pins that with
   * `ultra_on_multi_agent_v1_uses_max_without_mode_instructions`.
   */
  multiAgentVersion?: MultiAgentVersion | null;
}

/*
 * `MultiAgentMode::from_effort`, i.e. upstream's own `match`, and nothing else.
 *
 * This table used to carry a `guidance` string per rung — "Work carefully" at
 * high, "Be exhaustive" at max. Those were invented. Upstream derives exactly
 * one thing from effort beyond the API value, and that one thing is the
 * multi-agent mode.
 *
 * An earlier version also named tools in that guidance ("Plan before acting
 * with `update_plan`", "Verify the result with `computer_use`"), which made
 * both unconditional — every run opened with a plan and closed with a browser
 * session, whatever the user had asked for. Upstream's own prompt already
 * decides both, and decides them better: its planning section says outright
 * not to plan simple or single-step work, and its validation guidance is
 * explicitly a judgement call. Naming a tool here overrode all of it.
 *
 * Derived from the rule rather than written out as eight rows, so there is no
 * table left to fall out of step with `multiAgentModeForEffort`.
 */
const HARNESS_EFFORT: Record<CodexEffort, HarnessEffort> = Object.fromEntries(
  CODEX_EFFORTS.map((effort) => [
    effort,
    {
      multiAgentMode: multiAgentModeForEffort(effort),
      maxConcurrentAgents: DEFAULT_MAX_CONCURRENT_AGENTS,
    },
  ]),
) as Record<CodexEffort, HarnessEffort>;

export const harnessEffort = (effort: CodexEffort): HarnessEffort => HARNESS_EFFORT[effort];

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
  /** Delegation mode and prompt guidance, from the request. */
  harness: HarnessEffort;
  /** Catalog capability used to derive Ultra's proactive mode. */
  multiAgentVersion: MultiAgentVersion | null;
}

export function resolveMultiAgentVersion(model: {
  multiAgentVersion?: MultiAgentVersion | string | null;
  supportsMultiAgent?: boolean;
}): MultiAgentVersion | null {
  if (model.supportsMultiAgent === false) return null;
  if (model.multiAgentVersion === 'v1' || model.multiAgentVersion === 'v2') return model.multiAgentVersion;
  if (model.supportsMultiAgent === true) return 'v2';
  // Spark's forked browser runtime implements the V2 protocol itself. Saved
  // models may explicitly disable or downgrade this, matching Codex catalog
  // gating while keeping the browser fork usable with legacy model records.
  return 'v2';
}

export function resolveEffort(
  requested: CodexEffort,
  model: { providerId?: string; modelId?: string; name?: string; reasoningEfforts?: readonly unknown[]; multiAgentVersion?: MultiAgentVersion | string | null; supportsMultiAgent?: boolean },
): ResolvedEffort {
  const supported = supportedEfforts(model);
  const multiAgentVersion = resolveMultiAgentVersion(model);

  // The harness always runs at what was asked for — that half is model-agnostic.
  const harness = harnessEffort(requested);

  /*
   * Ultra, exactly as upstream handles it.
   *
   * It is not a backend token, so it is lowered to whatever this model's real
   * ceiling is — `max` where that exists, `high` where it does not. That is not
   * a clamp and must not be reported as one: the reasoning goes as high as the
   * model can go, and the thing Ultra actually selects — proactive delegation —
   * is delivered in full on every model.
   */
  if (requested === 'ultra') {
    const ceiling = supported[supported.length - 1] ?? 'high';
    /*
     * The V2 gate, which is upstream's and is not cosmetic.
     *
     * `effective_multi_agent_mode` bails out before deriving anything when the
     * turn is not eligible for multi-agent V2, so Ultra on V1 gets the API
     * value and *no* mode fragment — pinned upstream by
     * `ultra_on_multi_agent_v1_uses_max_without_mode_instructions`. Falling
     * back to the explicit-request-only text instead would send a paragraph
     * upstream never sends, telling the model not to do something it was never
     * invited to do.
     */
    const harness = multiAgentVersion === 'v2'
      ? { ...harnessEffort(requested), multiAgentVersion }
      : { ...harnessEffort(requested), multiAgentMode: EXPLICIT_REQUEST_ONLY, multiAgentVersion };
    return {
      requested,
      effective: ceiling,
      level: effortToLevel(ceiling),
      clamped: false,
      harness: { ...harness, multiAgentVersion },
      multiAgentVersion,
    };
  }

  if (supported.includes(requested)) {
    return {
      requested,
      effective: requested,
      level: effortToLevel(requested),
      clamped: false,
      harness: { ...harness, multiAgentVersion },
      multiAgentVersion,
    };
  }

  // Fall to the highest supported rung at or below the request, so asking for
  // more never accidentally yields less than the next level down.
  const wanted = CODEX_EFFORTS.indexOf(requested);
  let effective = supported[0] ?? 'medium';
  for (const candidate of supported) {
    if (CODEX_EFFORTS.indexOf(candidate) <= wanted) effective = candidate;
  }

  return { requested, effective, level: effortToLevel(effective), clamped: true, harness: { ...harness, multiAgentVersion }, multiAgentVersion };
}
