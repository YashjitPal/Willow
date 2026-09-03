/**
 * Which tools the Agent harness exposes, and why.
 *
 * The prompt overlay tells the model it has no shell; this file makes that
 * true. Both halves are needed — prose alone does not stop a determined model
 * from emitting a `shell` call, and a missing implementation alone produces a
 * confusing error instead of a clear refusal.
 *
 * `DENIED` is not dead weight. A denied tool that the model calls anyway gets a
 * specific, actionable error back rather than "unknown tool", which is what
 * lets the model recover inside the same turn instead of stalling.
 */

export type ToolId =
  | 'apply_patch'
  | 'read_file'
  | 'list_files'
  | 'search_files'
  | 'update_plan'
  | 'add_dependency'
  | 'run_command'
  | 'computer_use'
  /** Plan mode's question tool. See `../runtime/request-user-input.ts`. */
  | 'request_user_input'
  /** Goal mode's three tools. See `../runtime/goal.ts`. */
  | 'get_goal'
  | 'create_goal'
  | 'update_goal'
  /**
   * Upstream's multi-agent V2 collaboration tools. See
   * `../runtime/collaboration.ts`.
   *
   * There used to be one tool here called `task`, which blocked until its
   * helper finished. `task` does not exist anywhere in codex-rs, and a blocking
   * helper cannot do the thing delegation is for — upstream's own guidance is
   * that you spawn several and *keep working* while they run.
   */
  | 'spawn_agent'
  | 'send_message'
  | 'followup_task'
  | 'wait_agent'
  | 'interrupt_agent'
  | 'list_agents'
  /**
   * Skills, namespaced as upstream namespaces them
   * (`SKILLS_NAMESPACE = "skills"`). The dotted names are the ones upstream's
   * own catalog text tells the model to call — `skills.read({"package": …})` —
   * so keeping them means that guidance stays true.
   */
  | 'skills.list'
  | 'skills.read';

export interface DeniedTool {
  /** Names the model is likely to try, including upstream's own spellings. */
  aliases: string[];
  /** Returned to the model verbatim when it calls one of the aliases. */
  refusal: string;
}

/**
 * Tools the harness implements.
 *
 * `apply_patch`, `read_file`, `update_plan`, `request_user_input` and the three
 * `*_goal` tools mirror upstream Codex. The rest are Willow additions for a
 * sandbox that has no shell to fall back on: without `search_files` the model
 * would reach for `rg`, and without `add_dependency` it would reach for
 * `npm install`.
 *
 * **This is the superset, not the per-turn list.** Which of these a given turn
 * actually gets depends on the collaboration mode and on whether Goal mode is
 * running — `toolsForTurn` below is the function that answers that, and
 * `runTurn` registers only what it returns. Keeping the superset here means a
 * tool the model calls out of mode still gets a specific, mode-aware refusal
 * rather than "unknown tool".
 */
export const ALLOWED_TOOLS: ToolId[] = [
  'apply_patch',
  'read_file',
  'list_files',
  'search_files',
  'update_plan',
  'add_dependency',
  'run_command',
  'computer_use',
  'request_user_input',
  'get_goal',
  'create_goal',
  'update_goal',
  'spawn_agent',
  'send_message',
  'followup_task',
  'wait_agent',
  'interrupt_agent',
  'list_agents',
  'skills.list',
  'skills.read',
];

/**
 * The two skill tools, offered only when the library has something in it.
 *
 * Withheld on an empty library rather than left in place returning nothing: the
 * catalog section is also absent then, so a model offered `skills.read` with no
 * catalog would have nothing to pass it.
 */
export const SKILL_TOOLS: ToolId[] = ['skills.list', 'skills.read'];

/** The three goal tools, as one group — they are only ever offered together. */
export const GOAL_TOOLS: ToolId[] = ['get_goal', 'create_goal', 'update_goal'];

/**
 * The six collaboration tools, as one group.
 *
 * **Every agent gets all six, including agents spawned by other agents.** That
 * is upstream's rule, stated in `spawn_agent`'s own description — "The spawned
 * agent will have the same tools as you and the ability to spawn its own
 * subagents" — and repeated in the sub-agent role hint. `collab_tools_enabled`
 * only applies a depth limit under multi-agent **V1**; V2 has none.
 *
 * Spark's harness caps delegation at one level by withholding `spawn_agent`
 * from children. That is a deliberate product decision there, not a defect, and
 * it is the right one for a surface that runs unattended on a schedule — an
 * unbounded tree spending tokens with nobody watching is a different risk from
 * one a user is sitting in front of. The two harnesses differ here on purpose;
 * do not "fix" either to match the other.
 */
export const COLLABORATION_TOOLS: ToolId[] = [
  'spawn_agent',
  'send_message',
  'followup_task',
  'wait_agent',
  'interrupt_agent',
  'list_agents',
];

/**
 * Tools available for one turn.
 *
 * Three exclusions, each mirroring upstream:
 *
 * - **`request_user_input` outside Plan mode.** `ModeKind::allows_request_user_input`
 *   is true for Plan only. It stays in `ALLOWED_TOOLS` so a Default-mode call
 *   gets upstream's "unavailable in Default mode" message.
 * - **The goal tools with no goal session.** Upstream installs them from the
 *   `ext/goal` extension, so a thread without it has no such tools at all.
 * - **`update_plan` in Plan mode.** Refused by the handler rather than removed,
 *   because the mode document promises the model a specific error if it tries —
 *   see `UPDATE_PLAN_IN_PLAN_MODE_ERROR`.
 */
export function toolsForTurn(options: {
  mode: 'plan' | 'default';
  goalActive: boolean;
  /** True when the skill library has at least one enabled skill. */
  skillsAvailable?: boolean;
}): ToolId[] {
  return ALLOWED_TOOLS.filter((tool) => {
    if (tool === 'request_user_input') return options.mode === 'plan';
    if (GOAL_TOOLS.includes(tool)) return options.goalActive;
    if (SKILL_TOOLS.includes(tool)) return options.skillsAvailable === true;
    return true;
  });
}

const NO_SHELL =
  'There is no shell in this environment. Use `apply_patch` to change files, ' +
  '`read_file` and `search_files` to inspect them, `add_dependency` to add a ' +
  'package, and `run_command` for the small set of sandbox operations that do ' +
  'exist. Do not tell the user to run a command either — the sandbox rebundles ' +
  'and reloads on its own.';

export const DENIED_TOOLS: DeniedTool[] = [
  {
    // `run_command` is deliberately absent: it is a real, allow-listed tool
    // that refuses anything outside its list, with a message naming what the
    // agent should have used instead.
    aliases: ['shell', 'bash', 'sh', 'exec', 'run', 'terminal', 'local_shell'],
    refusal: NO_SHELL,
  },
  {
    aliases: ['npm', 'npm_install', 'yarn', 'pnpm', 'install', 'install_package'],
    refusal:
      'Package installation is not a command here. Add the package to the ' +
      '`dependencies` object in `/package.json` with `apply_patch`, or call ' +
      '`add_dependency`, in the same turn as the import that needs it.',
  },
  {
    aliases: ['write_file', 'create_file', 'edit_file', 'str_replace', 'str_replace_editor'],
    refusal:
      'File edits go through `apply_patch` only, using the V4A patch format. ' +
      'Use `*** Add File:` to create, `*** Update File:` with @@ hunks to ' +
      'modify, and `*** Delete File:` to remove.',
  },
  {
    aliases: ['view_image', 'browser', 'web_search', 'fetch', 'curl'],
    refusal:
      'This environment has no network access and no browser tool. Work from ' +
      'the project files and what the user told you.',
  },
];

/** Resolves a tool name the model emitted to a refusal, if it is denied. */
export function refusalFor(toolName: string): string | null {
  const needle = toolName.trim().toLowerCase();
  for (const denied of DENIED_TOOLS) {
    if (denied.aliases.includes(needle)) return denied.refusal;
  }
  return null;
}

/**
 * `mcp__<server>__<tool>`, upstream's flattened MCP tool name.
 *
 * Matched by prefix rather than listed, because the set is whatever the user
 * connected and is not knowable at build time. Kept in step with
 * `MCP_TOOL_PREFIX`/`MCP_TOOL_DELIMITER` in `@willow/ai/mcp/mcp-protocol`, and
 * duplicated as a literal here so this module stays free of an import into the
 * MCP subsystem — the policy has no business depending on the transport.
 */
const MCP_TOOL_NAME = /^mcp__[^_]/;

export const isMcpTool = (toolName: string): boolean => MCP_TOOL_NAME.test(toolName);

export function isAllowed(toolName: string): toolName is ToolId {
  // An MCP tool is allowed if a server offered it. Whether it is *registered*
  // is decided per turn by what is connected, and `runCall` reports an
  // unregistered one as unknown — which is the truth: the server is gone.
  if (isMcpTool(toolName)) return true;
  return (ALLOWED_TOOLS as string[]).includes(toolName);
}
