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
  manifest: manifest as unknown as UpstreamManifest,
} as const;

/** Short provenance string for the UI's "about this harness" affordance. */
export const upstreamLabel = (): string =>
  `openai/codex ${UPSTREAM.manifest.ref} (${UPSTREAM.manifest.commit.slice(0, 7)})`;
