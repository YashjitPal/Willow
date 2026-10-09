/**
 * Which tools the Spark harness exposes, and why.
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
  /** Plan mode's question tool. See `../runtime/request-user-input.ts`. */
  | 'request_user_input'
  | 'add_dependency'
  | 'run_command'
  | 'spawn_agent'
  | 'send_message'
  | 'followup_task'
  | 'wait_agent'
  | 'interrupt_agent'
  | 'list_agents'
  | 'get_goal'
  | 'create_goal'
  | 'update_goal'
  | 'connected_app'
  | 'use_skill'
  /** Spark's remote browser. See `../spark-tools.ts`. */
  | 'computer'
  /** A schedule Spark runs on its own, and a skill applied with "/". See `../spark-tools.ts`. */
  | 'create_schedule'
  | 'create_skill'
  /** Codex's unified exec, registered only by the desktop app's native runtime. See `../native/native-tools.ts`. */
  | 'exec_command'
  | 'write_stdin'
  /** A connected app's tool, `app:list_recent_emails`. See `../spark-tools.ts`. */
  | `app:${string}`
  | `mcp:${string}`;

export interface DeniedTool {
  /** Names the model is likely to try, including upstream's own spellings. */
  aliases: string[];
  /** Returned to the model verbatim when it calls one of the aliases. */
  refusal: string;
}

/**
 * Tools the harness implements.
 *
 * `apply_patch`, `read_file` and `update_plan` mirror upstream Codex. The rest
 * are Willow additions for a sandbox that has no shell to fall back on: without
 * `search_files` the model would reach for `rg`, and without `add_dependency`
 * it would reach for `npm install`.
 */
export const ALLOWED_TOOLS: ToolId[] = [
  'apply_patch',
  'read_file',
  'list_files',
  'search_files',
  'update_plan',
  'request_user_input',
  'add_dependency',
  'run_command',
  'spawn_agent',
  'send_message',
  'followup_task',
  'wait_agent',
  'interrupt_agent',
  'list_agents',
  'get_goal',
  'create_goal',
  'update_goal',
  'use_skill',
  'computer',
  'create_schedule',
  'create_skill',
];

/**
 * Tools available for one turn.
 *
 * One exclusion, mirroring upstream: **`request_user_input` outside Plan
 * mode.** `ModeKind::allows_request_user_input` is true for Plan only. It stays
 * in `ALLOWED_TOOLS` so that a Default-mode call still resolves to upstream's
 * "unavailable in Default mode" message rather than "unknown tool" — a model
 * reading the latter concludes the capability does not exist at all.
 *
 * `update_plan` is deliberately *not* excluded in Plan mode. Upstream keeps it
 * registered and refuses it in the handler, because the mode document promises
 * the model that exact error if it tries — see `UPDATE_PLAN_IN_PLAN_MODE_ERROR`.
 *
 * Everything else Spark exposes is unconditional here, including the
 * collaboration tools: those are owned by `../runtime/collaboration` and their
 * availability is not a function of the mode.
 */
export function toolsForTurn(options: {
  mode: 'plan' | 'default';
  /**
   * Whether the agent may ask questions outside Plan mode. **Defaults to on**,
   * because that is what the Codex app ships.
   *
   * This is easy to get wrong from the Rust alone.
   * `Feature::DefaultModeRequestUserInput` is declared `default_enabled: false`
   * in `codex-rs/features/src/lib.rs`, which reads like "off by default" — but
   * that is the CLI's compiled fallback. The app carries its own gate,
   * `default-mode-request-user-input-enabled`, whose default is `true`, and it
   * only forces the feature off when that gate is false. So in the app the
   * agent can ask while working, with nothing switched on.
   *
   * What the mode still decides is **blocking**: `is_blocking: mode ==
   * ModeKind::Plan`. In Plan mode the turn stops for the answer; outside it the
   * agent asks and carries on. That is the real difference between the two, not
   * whether the tool exists.
   */
  askOutsidePlanMode?: boolean;
}): ToolId[] {
  const askOutsidePlanMode = options.askOutsidePlanMode !== false;
  return ALLOWED_TOOLS.filter((tool) => {
    if (tool === 'request_user_input') {
      return options.mode === 'plan' || askOutsidePlanMode;
    }
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
    aliases: ['browser', 'browse', 'web_browser', 'open_browser', 'remote_browser', 'computer_use', 'browser_use'],
    refusal:
      'The remote browser is the `computer` call. Emit `computer` with ' +
      '{"title":"<short step label>","task":"<self-contained browser instruction>","url":"<optional start page>"}.',
  },
  {
    aliases: ['schedule', 'schedule_task', 'create_reminder', 'set_reminder', 'create_routine', 'create_automation'],
    refusal:
      'A recurring task is the `create_schedule` call: ' +
      '{"title":"<name>","frequency":"Daily|Weekly","weekdays":["Sunday"],"time":"HH:mm","instructions":"<what each run does>"}.',
  },
  {
    aliases: ['save_skill', 'add_skill', 'new_skill', 'write_skill'],
    refusal:
      'A skill is the `create_skill` call: ' +
      '{"name":"<kebab-case-name>","description":"<what it does and when to use it>","instructions":"<the skill, in Markdown>"}.',
  },
  {
    aliases: ['view_image', 'fetch', 'curl'],
    refusal:
      'There is no arbitrary network tool. Use the native Google Search capability ' +
      'for web research, or the `computer` call when a live website has to be opened.',
  },
];

/** Resolves a tool name the model emitted to a refusal, if it is denied. */
export function refusalFor(toolName: string): string | null {
  return refusalIn(DENIED_TOOLS, toolName);
}

const refusalIn = (denied: DeniedTool[], toolName: string): string | null => {
  const needle = toolName.trim().toLowerCase();
  return denied.find((entry) => entry.aliases.includes(needle))?.refusal ?? null;
};

/**
 * Tools only the desktop app's native runtime registers. They are allowed by name
 * so they dispatch there; the web runtime never registers them, so on the web a
 * call to one is still an unknown tool.
 */
export const NATIVE_TOOLS: ToolId[] = ['exec_command', 'write_stdin'];

const NATIVE_SHELL =
  'Commands run through `exec_command`: {"cmd":"<command>"}, optionally with "workdir". ' +
  'A command still running when it yields returns a session ID; continue it with `write_stdin`.';

/**
 * Refusals in the desktop app's native runtime, where there is a real shell: the
 * shell and package-manager spellings point at `exec_command` instead of saying
 * there is none. The rest are the web runtime's.
 */
export const NATIVE_DENIED_TOOLS: DeniedTool[] = [
  {
    aliases: ['shell', 'bash', 'sh', 'exec', 'run', 'terminal', 'local_shell', 'shell_command', 'powershell', 'cmd', 'container.exec'],
    refusal: NATIVE_SHELL,
  },
  {
    aliases: ['npm', 'npm_install', 'yarn', 'pnpm', 'install', 'install_package', 'add_dependency'],
    refusal: 'Install packages by running the package manager with `exec_command` in the project\'s folder, as you would in a terminal.',
  },
  ...DENIED_TOOLS.filter((denied) => !denied.aliases.includes('shell') && !denied.aliases.includes('npm') && !denied.aliases.includes('view_image')),
  {
    aliases: ['fetch', 'curl', 'http', 'web_fetch'],
    refusal: 'Fetch over the network with `exec_command` (for example `curl.exe -sL <url>`), or use the native Google Search capability for research.',
  },
  {
    aliases: ['view_image'],
    refusal: 'Images on disk cannot be viewed in this runtime. Inspect an image\'s metadata with a command if you need it, or ask the user to attach it.',
  },
];

export function nativeRefusalFor(toolName: string): string | null {
  return refusalIn(NATIVE_DENIED_TOOLS, toolName);
}

export function isAllowed(toolName: string): toolName is ToolId {
  return (ALLOWED_TOOLS as string[]).includes(toolName)
    || (NATIVE_TOOLS as string[]).includes(toolName)
    || toolName === 'connected_app'
    || toolName.startsWith('app:')
    || toolName.startsWith('mcp:');
}
