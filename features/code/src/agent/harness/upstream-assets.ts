/**
 * The single place that reads the vendored upstream files.
 *
 * Everything else in the harness imports from here rather than reaching into
 * `upstream/` directly, so the set of upstream artifacts the code depends on is
 * one short list rather than a search across the feature. `?raw` keeps the text
 * byte-identical to what `sync-codex-upstream.mjs` fetched — no transform, no
 * line-ending normalisation.
 */

import promptWithApplyPatch from './upstream/prompt_with_apply_patch_instructions.md?raw';
import applyPatchInstructions from './upstream/apply_patch_tool_instructions.md?raw';
import applyPatchGrammar from './upstream/apply_patch.lark?raw';
import collaborationModePlan from './upstream/collaboration_mode_plan.md?raw';
import collaborationModeDefault from './upstream/collaboration_mode_default.md?raw';
import goalContinuation from './upstream/goal_continuation.md?raw';
import goalBudgetLimit from './upstream/goal_budget_limit.md?raw';
import goalObjectiveUpdated from './upstream/goal_objective_updated.md?raw';
import manifest from './upstream/MANIFEST.json';

export interface UpstreamManifest {
  repository: string;
  license: string;
  ref: string;
  commit: string;
  fetchedAt: string;
  files: { upstream: string; local: string; role: string; bytes: number; sha256: string }[];
}

export const UPSTREAM = {
  /** Codex's base agent prompt, including its apply_patch section. */
  prompt: promptWithApplyPatch,
  /** The apply_patch tool description handed to the model. */
  applyPatchInstructions,
  /** Lark grammar for the freeform apply_patch tool. */
  applyPatchGrammar,
  /**
   * The two collaboration-mode templates, from
   * `codex-rs/collaboration-mode-templates/templates/`.
   *
   * These are the whole of Plan mode upstream: the mode is a developer message
   * carrying one of these documents, not a code path. `default.md` carries a
   * `{{KNOWN_MODE_NAMES}}` placeholder; everything else is literal.
   */
  collaborationMode: {
    plan: collaborationModePlan,
    default: collaborationModeDefault,
  },
  /**
   * The goal-steering templates, from `codex-rs/ext/goal/templates/goals/`.
   *
   * Each is rendered with the live goal's objective and budget and submitted as
   * the sole input of an automatic continuation turn — see `runtime/goal.ts`.
   */
  goal: {
    continuation: goalContinuation,
    budgetLimit: goalBudgetLimit,
    objectiveUpdated: goalObjectiveUpdated,
  },
  manifest: manifest as unknown as UpstreamManifest,
} as const;

/** Short provenance string for the UI's "about this harness" affordance. */
export const upstreamLabel = (): string =>
  `openai/codex ${UPSTREAM.manifest.ref} (${UPSTREAM.manifest.commit.slice(0, 7)})`;
