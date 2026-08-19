/**
 * The assembled Spark harness profile.
 *
 * This is the seam the runtime talks to: it asks for a profile and gets a
 * prompt, a tool list, and the policy for refusing everything else. Nothing
 * downstream of here knows that half the prompt came from a vendored file.
 */

import { UPSTREAM, upstreamLabel } from '../upstream-assets';
import { buildOverlay, composePrompt, type ComposeResult } from './prompt-overlay';
import { ALLOWED_TOOLS, refusalFor, type ToolId } from './tool-policy';

export interface HarnessProfile {
  /** The fully composed system prompt. */
  systemPrompt: string;
  /** Tool ids the runtime should register. */
  tools: ToolId[];
  /** Refusal text for a denied tool name, or null when the name is unknown. */
  refusalFor: (toolName: string) => string | null;
  /** Provenance, surfaced in the UI. */
  upstream: {
    label: string;
    ref: string;
    commit: string;
  };
  /** Audit trail of overlay operations, for the debug panel. */
  overlay: Pick<ComposeResult, 'applied' | 'skipped'>;
}

export { composePrompt };

let cached: HarnessProfile | null = null;

/**
 * Builds the profile once per session.
 *
 * Composition is pure and cheap, but it can throw `OverlayAnchorError` after an
 * upstream upgrade; caching means that surfaces once at first use rather than
 * on every turn.
 */
export function getHarnessProfile(): HarnessProfile {
  if (cached) return cached;

  const composed = composePrompt(
    UPSTREAM.prompt,
    buildOverlay({ applyPatchInstructions: UPSTREAM.applyPatchInstructions }),
  );

  cached = {
    systemPrompt: composed.prompt,
    tools: ALLOWED_TOOLS,
    refusalFor,
    upstream: {
      label: upstreamLabel(),
      ref: UPSTREAM.manifest.ref,
      commit: UPSTREAM.manifest.commit,
    },
    overlay: { applied: composed.applied, skipped: composed.skipped },
  };

  return cached;
}

/** Test and dev-tool hook; the app itself never needs this. */
export function resetHarnessProfile(): void {
  cached = null;
}
