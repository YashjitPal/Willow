/**
 * The assembled Agent harness profile.
 *
 * This is the seam the runtime talks to: it asks for a profile and gets a
 * prompt, a tool list, and the policy for refusing everything else. Nothing
 * downstream of here knows that half the prompt came from a vendored file.
 *
 * ## Two layers, and why they are separate
 *
 * `getHarnessProfile()` is the **session** layer: upstream's prompt with
 * Willow's overlay applied. It is pure, cached, and identical for every turn.
 *
 * `composeSystemPrompt()` is the **turn** layer. Collaboration mode, multi-agent
 * mode and the live goal all change per turn, and upstream delivers each of them
 * as its own `developer`-role message appended after the base instructions
 * rather than by rebuilding the prompt. Keeping the split means a mode switch
 * costs a string concatenation instead of re-parsing a 24,000-character
 * document, and it keeps the ordering upstream relies on: base instructions,
 * then mode, then multi-agent mode, then turn context.
 */

import { UPSTREAM, upstreamLabel } from '../upstream-assets';
import { buildOverlay, composePrompt, type ComposeResult } from './prompt-overlay';
import { ALLOWED_TOOLS, refusalFor, toolsForTurn, type ToolId } from './tool-policy';
import { collaborationModeSection, type ModeKind } from './collaboration-mode';
import { multiAgentModeSection, type MultiAgentMode } from './multi-agent-mode';

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

export interface TurnPromptOptions {
  mode: ModeKind;
  multiAgentMode: MultiAgentMode;
  /** `<thread_goal>` block for a live goal, or empty. */
  goalContext?: string;
  /**
   * The skills catalog — one line per skill, from `renderSkillsSection`.
   *
   * In the prompt rather than behind a tool because selection happens before
   * any tool call: the model has to know a skill exists to decide to read it.
   * Upstream calls the two-step progressive disclosure.
   */
  skillsCatalog?: string;
  /**
   * The MCP tool list, from `renderMcpSection`.
   *
   * Separate from the tool-protocol section because it is per-turn — it depends
   * on which servers the user has connected right now — while the rest of the
   * tool documentation is fixed for the session.
   */
  mcpCatalog?: string;
  /** Appended last, so it is the most recent thing the model read. */
  turnContext?: string;
}

/**
 * The system prompt for one turn.
 *
 * Order is upstream's and is not arbitrary. The mode document asserts that the
 * agent's mode "changes only when new developer instructions with a different
 * `<collaboration_mode>` change it", and the multi-agent texts both open by
 * revoking the other — so both have to come *after* the base instructions, and
 * the later one has to win. Appending in this order is what makes those
 * sentences true.
 */
export function composeSystemPrompt(options: TurnPromptOptions): string {
  return [
    getHarnessProfile().systemPrompt,
    collaborationModeSection(options.mode),
    multiAgentModeSection(options.multiAgentMode),
    options.skillsCatalog,
    options.mcpCatalog,
    options.goalContext,
    options.turnContext,
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join('\n\n');
}

/** Re-exported so the runtime has one import for the whole overlay surface. */
export { toolsForTurn };
