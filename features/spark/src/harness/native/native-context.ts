/**
 * What the native runtime tells the model about where it is, in Codex's own
 * shapes: the `<environment_context>` fragment, the `<permissions instructions>`
 * fragment built from Codex's permission templates, and AGENTS.md project
 * instructions discovered the way `codex-rs/core/src/agents_md.rs` discovers them.
 */

import type { NativeApprovalMode } from './native-approvals';
import type { NativeFile, NativeStat } from './native-host';
import type { NativePaths } from './native-paths';

const escapeXml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);

/** The local date and time zone, as Codex renders them. */
export const currentDate = (now: Date): string => {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Codex's environment context for one local environment with no sandbox: the
 * permission profile is `disabled`, so the file system is unrestricted.
 */
export const renderEnvironmentContext = (input: { cwd: string; shell: string; now: Date; timezone: string }): string => [
  '<environment_context>',
  `  <cwd>${escapeXml(input.cwd)}</cwd>`,
  `  <shell>${escapeXml(input.shell)}</shell>`,
  `  <current_date>${currentDate(input.now)}</current_date>`,
  `  <timezone>${escapeXml(input.timezone)}</timezone>`,
  '  <filesystem><permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem>',
  '</environment_context>',
].join('\n');

/* Codex's permission templates, verbatim (codex-rs/prompts/templates/permissions/). */
const DANGER_FULL_ACCESS = 'Filesystem sandboxing defines which files can be read or written. `sandbox_mode` is `danger-full-access`: No filesystem sandboxing - all commands are permitted. Network access is {{ network_access }}.';
const UNLESS_TRUSTED = ' `approval_policy` is `unless-trusted`: The harness will require user approval before running commands unless an explicit exec policy rule allows them.';
const NEVER = 'Approval policy is currently never. Do not provide the `sandbox_permissions` for any reason, commands will be rejected.';
const APPROVED_PREFIXES = '## Approved command prefixes\nThe following prefix rules have already been approved: ';

/** `format_allow_prefixes`: each rule as a JSON array of its parts. */
const formatPrefixes = (rules: readonly (readonly string[])[]): string => rules.map((rule) => JSON.stringify(rule)).join(', ');

/**
 * Codex's `<permissions instructions>` for this runtime: no sandbox, network on,
 * and approvals as the task's mode sets them. Approved prefix rules are listed so
 * the model knows which commands will not ask.
 */
export const renderPermissionsInstructions = (mode: NativeApprovalMode, rules: readonly (readonly string[])[]): string => {
  const sections = [DANGER_FULL_ACCESS.replace('{{ network_access }}', 'enabled'), mode === 'full' ? NEVER : UNLESS_TRUSTED];
  if (mode === 'ask' && rules.length) sections.push(`${APPROVED_PREFIXES}${formatPrefixes(rules)}`);
  return `<permissions instructions>\n${sections.join('\n')}\n</permissions instructions>`;
};

/* ------------------------------------------------------------------------ */
/* AGENTS.md                                                                 */
/* ------------------------------------------------------------------------ */

export const AGENTS_MD = 'AGENTS.md';
export const AGENTS_OVERRIDE_MD = 'AGENTS.override.md';
/** `project_doc_max_bytes`'s default. */
export const AGENTS_MD_MAX_BYTES = 32 * 1024;

export interface AgentsMdFile {
  directory: string;
  path: string;
  text: string;
}

export interface AgentsMdFs {
  stat: (path: string) => Promise<NativeStat>;
  read: (paths: string[]) => Promise<NativeFile[]>;
}

const parentOf = (path: string, windows: boolean): string | null => {
  const trimmed = path.replace(/[\\/]+$/, '');
  const at = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  if (at <= 0) return windows ? null : (trimmed === '' ? null : '/');
  const parent = trimmed.slice(0, at);
  if (windows && /^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
  return parent;
};

const join = (directory: string, name: string, windows: boolean): string =>
  `${directory.replace(/[\\/]+$/, '')}${windows ? '\\' : '/'}${name}`;

/**
 * AGENTS.md files from the project root down to the working folder. The root is
 * the nearest folder holding `.git`; without one, only the working folder counts.
 * In each folder `AGENTS.override.md` wins over `AGENTS.md`. The total is capped at
 * 32 KiB, truncating the file that crosses it.
 */
export const discoverAgentsMd = async (fs: AgentsMdFs, paths: NativePaths, maxBytes = AGENTS_MD_MAX_BYTES): Promise<AgentsMdFile[]> => {
  const chain: string[] = [];
  let cursor: string | null = paths.cwd;
  let root: string | null = null;
  while (cursor) {
    chain.push(cursor);
    const git = await fs.stat(join(cursor, '.git', paths.windows)).catch(() => null);
    if (git?.exists) {
      root = cursor;
      break;
    }
    cursor = parentOf(cursor, paths.windows);
  }
  const directories = root ? chain.reverse() : [paths.cwd];
  const candidates = directories.flatMap((directory) => [join(directory, AGENTS_OVERRIDE_MD, paths.windows), join(directory, AGENTS_MD, paths.windows)]);
  const files = await fs.read(candidates).catch(() => [] as NativeFile[]);
  const byPath = new Map(files.map((file) => [file.path.toLowerCase(), file]));
  const found: AgentsMdFile[] = [];
  let remaining = maxBytes;
  for (const directory of directories) {
    if (remaining <= 0) break;
    const file = [AGENTS_OVERRIDE_MD, AGENTS_MD]
      .map((name) => byPath.get(join(directory, name, paths.windows).toLowerCase()))
      .find((entry) => entry?.exists && !entry.isDirectory && typeof entry.text === 'string');
    if (!file?.text?.trim()) continue;
    const text = new TextEncoder().encode(file.text).length > remaining ? truncateBytes(file.text, remaining) : file.text;
    remaining -= new TextEncoder().encode(text).length;
    found.push({ directory, path: file.path, text });
  }
  return found;
};

const truncateBytes = (text: string, bytes: number): string => {
  let used = 0;
  let out = '';
  for (const char of text) {
    const size = new TextEncoder().encode(char).length;
    if (used + size > bytes) break;
    used += size;
    out += char;
  }
  return out;
};

/** Codex's `UserInstructions` fragment, one per discovered file. */
export const renderAgentsMd = (files: readonly AgentsMdFile[]): string =>
  files.map((file) => `# AGENTS.md instructions for ${file.directory}\n\n<INSTRUCTIONS>\n${file.text}\n</INSTRUCTIONS>`).join('\n\n');
