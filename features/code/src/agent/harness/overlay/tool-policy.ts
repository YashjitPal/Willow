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
  | 'task';

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
  'add_dependency',
  'run_command',
  'computer_use',
  'task',
];

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

export function isAllowed(toolName: string): toolName is ToolId {
  return (ALLOWED_TOOLS as string[]).includes(toolName);
}
