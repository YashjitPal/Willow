/**
 * Collaboration modes — upstream's Plan mode, ported.
 *
 * ## What Plan mode actually is upstream
 *
 * Not a prompt template and not a slash command. It is a *session mode*
 * (`ModeKind` in `codex-rs/protocol/src/config_types.rs`) with four moving
 * parts, and it only behaves correctly when all four are present:
 *
 * 1. **A developer message.** The mode's instructions are the whole of
 *    `collaboration-mode-templates/templates/{plan,default}.md`, injected in
 *    `<collaboration_mode>` tags with role `developer`. Both files are vendored
 *    verbatim; nothing here rewrites them.
 * 2. **`update_plan` is refused.** In Plan mode the plan tool returns an error
 *    — `codex-rs/core/src/tools/handlers/plan.rs` returns
 *    `RespondToModel("update_plan is a TODO/checklist tool and is not allowed
 *    in Plan mode")`. The two features are unrelated and upstream says so
 *    explicitly, in the mode document itself.
 * 3. **`request_user_input` becomes available.** `ModeKind::allows_request_user_input`
 *    is true for Plan and false for Default, and in Plan mode the call is
 *    *blocking* — the turn stops until the user answers.
 * 4. **Mutation is forbidden.** The mode document draws the line at
 *    "non-mutating actions that improve the plan".
 *
 * ## The one deliberate difference
 *
 * Upstream leaves (4) to the instructions. Willow enforces it. Upstream's
 * `apply_patch` is a tool call whose result the model waits for, so an
 * instruction not to call it is sufficient; Willow's patches apply *the moment
 * the envelope closes mid-stream*, before anything could refuse them. An
 * instruction-only boundary there would mean a model that ignores it has
 * already written the user's files. So `runtime/agent.ts` declines mutating
 * work in Plan mode and hands the model an observation, which is the same
 * outcome upstream gets from its read-only sandbox policy.
 *
 * Everything else — the mode names, the aliases, which tools are available,
 * and every error string — is upstream's.
 */

import { UPSTREAM } from '../upstream-assets';

/**
 * `ModeKind`, verified against `codex-rs/protocol/src/config_types.rs`.
 *
 * Upstream has exactly these two and no more. `code`, `pair_programming`,
 * `execute` and `custom` are serde *aliases* of `default` rather than modes of
 * their own, which is why `parseModeKind` accepts them.
 */
export type ModeKind = 'plan' | 'default';

/** `TUI_VISIBLE_COLLABORATION_MODES`, in upstream's order. */
export const COLLABORATION_MODES: ModeKind[] = ['default', 'plan'];

/** `ModeKind::display_name`. These strings appear in model-facing errors. */
export const MODE_DISPLAY_NAME: Record<ModeKind, string> = {
  plan: 'Plan',
  default: 'Default',
};

/** Upstream's serde aliases for `Default`. */
const MODE_ALIASES: Record<string, ModeKind> = {
  plan: 'plan',
  default: 'default',
  code: 'default',
  pair_programming: 'default',
  execute: 'default',
  custom: 'default',
};

export const parseModeKind = (value: unknown): ModeKind =>
  MODE_ALIASES[String(value ?? '').trim().toLowerCase()] ?? 'default';

/**
 * `ModeKind::allows_request_user_input` — true for Plan only.
 *
 * This is what makes Plan mode conversational rather than a one-shot: the mode
 * document tells the model to ask many questions, and this is the tool it is
 * told to ask them with.
 */
export const allowsRequestUserInput = (mode: ModeKind): boolean => mode === 'plan';

/** The modes `request_user_input` is offered in, for its generated description. */
export const REQUEST_USER_INPUT_MODES: ModeKind[] = COLLABORATION_MODES.filter(
  allowsRequestUserInput,
);

/* ------------------------------------------------------------------------ */
/* Model-facing strings, verbatim from upstream                              */
/* ------------------------------------------------------------------------ */

/**
 * `plan.rs`'s refusal. Reproduced exactly — it is the sentence that teaches the
 * model the two features are separate, and the mode document promises this
 * specific error will come back.
 */
export const UPDATE_PLAN_IN_PLAN_MODE_ERROR =
  'update_plan is a TODO/checklist tool and is not allowed in Plan mode';

/** `request_user_input_unavailable_message`. */
export function requestUserInputUnavailableMessage(
  mode: ModeKind,
  availableModes: ModeKind[] = REQUEST_USER_INPUT_MODES,
): string | null {
  if (availableModes.includes(mode)) return null;
  return `request_user_input is unavailable in ${MODE_DISPLAY_NAME[mode]} mode`;
}

/** `format_allowed_modes`. */
function formatAllowedModes(availableModes: ModeKind[]): string {
  const names = availableModes.map((mode) => MODE_DISPLAY_NAME[mode]);
  if (names.length === 0) return 'no modes';
  if (names.length === 1) return `${names[0]} mode`;
  if (names.length === 2) return `${names[0]} or ${names[1]} mode`;
  return `modes: ${names.join(',')}`;
}

/** `request_user_input_tool_description`. */
export const requestUserInputToolDescription = (
  availableModes: ModeKind[] = REQUEST_USER_INPUT_MODES,
): string =>
  'Request user input for one to three short questions and wait for the ' +
  `response. This tool is only available in ${formatAllowedModes(availableModes)}.`;

/* ------------------------------------------------------------------------ */
/* The developer message                                                     */
/* ------------------------------------------------------------------------ */

/** `COLLABORATION_MODE_{OPEN,CLOSE}_TAG`. */
export const COLLABORATION_MODE_OPEN_TAG = '<collaboration_mode>';
export const COLLABORATION_MODE_CLOSE_TAG = '</collaboration_mode>';

/**
 * The mode's instructions, rendered.
 *
 * `default.md` interpolates `{{KNOWN_MODE_NAMES}}` so the model can be told
 * which modes exist without the list being written twice. `plan.md` has no
 * placeholders and is returned untouched.
 */
export function collaborationModeInstructions(mode: ModeKind): string {
  const template = mode === 'plan' ? UPSTREAM.collaborationMode.plan : UPSTREAM.collaborationMode.default;
  const knownModeNames = COLLABORATION_MODES.map((known) => MODE_DISPLAY_NAME[known]).join(', ');
  return template.replace(/\{\{\s*KNOWN_MODE_NAMES\s*\}\}/g, knownModeNames).trim();
}

/**
 * The mode as the model receives it.
 *
 * Upstream sends this as its own `developer`-role message. Willow's transport
 * carries system / user / assistant only, so it is appended to the system
 * prompt — which is the same position in the conversation and the same
 * precedence. The tags are kept because the mode document refers to them: it
 * tells the model its mode changes only when a later
 * `<collaboration_mode>` message says so, and that sentence has to be true.
 */
export function collaborationModeSection(mode: ModeKind): string {
  return [
    COLLABORATION_MODE_OPEN_TAG,
    collaborationModeInstructions(mode),
    COLLABORATION_MODE_CLOSE_TAG,
  ].join('\n');
}

/* ------------------------------------------------------------------------ */
/* The mutation boundary                                                     */
/* ------------------------------------------------------------------------ */

/**
 * Tools whose purpose is to change the project.
 *
 * Drawn from the mode document's own two lists: writing files, applying
 * patches and running codegen are "not allowed"; reading, searching and
 * inspecting are.
 *
 * **The collaboration tools are deliberately absent.** Delegating is not
 * mutating: a spawned agent inherits its parent's mode, so an agent spawned in
 * Plan mode also declines to write. And exploring in parallel is precisely what
 * Plan mode asks for — Phase 1 requires "at least one targeted non-mutating
 * exploration pass" before asking the user anything, and upstream's `explorer`
 * role exists for exactly that. Blocking `spawn_agent` here would forbid the
 * mode's own first instruction.
 *
 * (`task` used to be in this set. It no longer exists — see
 * `../runtime/collaboration.ts`.)
 */
const MUTATING_TOOLS = new Set(['apply_patch', 'add_dependency']);

export const isMutatingTool = (toolName: string): boolean =>
  MUTATING_TOOLS.has(toolName.trim());

/**
 * What the model is told when it tries to mutate in Plan mode.
 *
 * Phrased as the mode document phrases it, and — as everywhere else in this
 * harness — returned as an observation rather than thrown, so the model can
 * correct course inside the same turn.
 */
export const planModeMutationRefusal = (toolName: string): string =>
  `${toolName} is a mutating action and is not allowed in Plan mode. Plan Mode ` +
  'permits non-mutating exploration that improves the plan — reading, ' +
  'searching, and inspecting — and forbids editing or writing files. Gather ' +
  'what you need, then present the plan in a `<proposed_plan>` block.';

/** The same, for a patch envelope, which arrives without a tool name. */
export const PLAN_MODE_PATCH_REFUSAL =
  'ERROR This patch was not applied. You are in Plan mode, which forbids ' +
  'mutating actions: editing or writing files, applying patches, and running ' +
  'codegen that updates tracked files. Nothing was written and the project is ' +
  'unchanged. Continue with non-mutating exploration, and when the plan is ' +
  'decision complete present it in a `<proposed_plan>` block.';
