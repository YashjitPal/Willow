/**
 * Multi-agent mode — what Ultra actually selects.
 *
 * ## The derivation, verified
 *
 * `codex-rs/core/src/session/multi_agents.rs`:
 *
 *     let multi_agent_mode = match &config.multi_agent_v2.multi_agent_mode_hint_text {
 *         Some(hint_text) => MultiAgentMode::Custom(hint_text.clone()),
 *         None => match turn_context.effective_reasoning_effort() {
 *             Some(ReasoningEffort::Ultra) => MultiAgentMode::Proactive,
 *             _ => MultiAgentMode::ExplicitRequestOnly,
 *         },
 *     };
 *
 * So Ultra is not "more reasoning". Reasoning is already at the ceiling by
 * then — `client.rs` lowers Ultra to `Max` on the wire. What Ultra changes is
 * *this*: one bit that flips delegation from "only when asked" to "when it
 * would help". That is the entire product difference, and it is why Ultra means
 * something on a model whose API tops out lower.
 *
 * ## Why the strings are copied rather than written
 *
 * The two texts below are `EXPLICIT_REQUEST_ONLY_MULTI_AGENT_MODE_TEXT` and
 * `PROACTIVE_MULTI_AGENT_MODE_TEXT` from
 * `codex-rs/core/src/context/multi_agent_mode_instructions.rs`, character for
 * character.
 *
 * They read oddly out of context — both open by revoking an earlier
 * instruction — and that is the point. Upstream re-sends this fragment whenever
 * the mode changes mid-session, so each text has to undo the other. Rewriting
 * them into something that reads better standalone is how a port stops being a
 * port: the "no longer applies" clause is what makes switching modes work at
 * all.
 */

import type { CodexEffort } from './effort';

/** `MultiAgentMode`. `Custom` carries operator-supplied text, as upstream's does. */
export type MultiAgentMode =
  | { kind: 'explicit-request-only' }
  | { kind: 'proactive' }
  | { kind: 'custom'; hintText: string };

export const EXPLICIT_REQUEST_ONLY: MultiAgentMode = { kind: 'explicit-request-only' };
export const PROACTIVE: MultiAgentMode = { kind: 'proactive' };

/** `MULTI_AGENT_MODE_{OPEN,CLOSE}_TAG`. */
export const MULTI_AGENT_MODE_OPEN_TAG = '<multi_agent_mode>';
export const MULTI_AGENT_MODE_CLOSE_TAG = '</multi_agent_mode>';

/** Upstream's `EXPLICIT_REQUEST_ONLY_MULTI_AGENT_MODE_TEXT`, verbatim. */
export const EXPLICIT_REQUEST_ONLY_TEXT =
  'Any earlier instruction enabling proactive multi-agent delegation no longer ' +
  'applies. Do not spawn sub-agents unless the user or applicable ' +
  'AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or ' +
  'parallel agent work.';

/** Upstream's `PROACTIVE_MULTI_AGENT_MODE_TEXT`, verbatim. */
export const PROACTIVE_TEXT =
  'Proactive multi-agent delegation is active. Any earlier instruction ' +
  'requiring an explicit user request before spawning sub-agents no longer ' +
  'applies. Use sub-agents when parallel work would materially improve speed ' +
  'or quality. This mode remains active until a later multi-agent mode ' +
  'developer message changes it.';

/** `MultiAgentMode::from_effort`, i.e. the `match` quoted above. */
export const multiAgentModeForEffort = (effort: CodexEffort): MultiAgentMode =>
  effort === 'ultra' ? PROACTIVE : EXPLICIT_REQUEST_ONLY;

/** `MultiAgentModeInstructions::body`. */
export function multiAgentModeText(mode: MultiAgentMode): string {
  switch (mode.kind) {
    case 'custom':
      return mode.hintText;
    case 'proactive':
      return PROACTIVE_TEXT;
    case 'explicit-request-only':
      return EXPLICIT_REQUEST_ONLY_TEXT;
  }
}

/**
 * The fragment, or nothing.
 *
 * `MultiAgentModeInstructions::from_mode` returns `None` for an empty custom
 * hint — an operator who configures a blank hint is asking for no fragment at
 * all, which is different from asking for the default one.
 */
export function multiAgentModeSection(mode: MultiAgentMode): string {
  if (mode.kind === 'custom' && mode.hintText === '') return '';
  return [MULTI_AGENT_MODE_OPEN_TAG, multiAgentModeText(mode), MULTI_AGENT_MODE_CLOSE_TAG].join(
    '\n',
  );
}
