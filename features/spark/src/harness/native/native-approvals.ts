/**
 * When a native command needs the user's approval.
 *
 * Two policies, which are Codex's two that make sense without an OS sandbox:
 *
 * - `ask` is Codex's `unless-trusted`: every command waits for the user unless an
 *   approved rule allows it.
 * - `full` is `never` with `danger-full-access`: nothing asks.
 *
 * Rules are Codex's prefix rules, matched as its policy matches them: the command
 * is split at shell control operators (pipes, `&&`, `||`, `;`, subshells) and
 * every segment must start with an approved prefix. A command that redirects,
 * substitutes, assigns variables or uses wildcards is never matched against a
 * rule, which keeps what an approval allows exactly what the user read.
 */

export type NativeApprovalMode = 'ask' | 'full';

export interface NativeApprovalRequest {
  kind: 'command' | 'patch';
  /** For a command, exactly what runs. */
  command?: string;
  /** Absolute. */
  cwd?: string;
  /** The model's one-line question for the user, from `justification`. */
  justification?: string;
  /** A reusable prefix the user may approve for the rest of the task, already checked. */
  prefixRule?: string[];
  /** For a patch, the files outside the working folder it changes. */
  paths?: string[];
}

/**
 * The user's answer. `prefix` approves the request's `prefixRule` for later
 * commands too; `task` switches the task to full access.
 */
export type NativeApprovalDecision = 'once' | 'prefix' | 'task' | 'deny';

export interface NativeApprovals {
  mode: () => NativeApprovalMode;
  rules: () => readonly (readonly string[])[];
  /** Asks the user and waits. Resolves `deny` if the turn is stopped. */
  request: (request: NativeApprovalRequest, signal?: AbortSignal) => Promise<NativeApprovalDecision>;
  addRule: (prefix: string[]) => void;
  allowAll: () => void;
}

/** A ready-made `NativeApprovals` for callers with no UI: full access, or always denied. */
export const fixedApprovals = (mode: NativeApprovalMode): NativeApprovals => ({
  mode: () => mode,
  rules: () => [],
  request: async () => 'deny',
  addRule: () => undefined,
  allowAll: () => undefined,
});

/* ------------------------------------------------------------------------ */
/* Splitting a command into rule-checkable segments                          */
/* ------------------------------------------------------------------------ */

/** Characters that, outside quotes, redirect, substitute, expand or glob. */
const ADVANCED_CHARS = new Set(['<', '>', '$', '`', '*', '?', '{', '}', '@', '%']);

/**
 * Splits `command` into argv-like segments at control operators, or returns null
 * when it uses a feature rules must not be applied to: redirection, variables or
 * substitution (also inside double quotes), wildcards, a leading `NAME=value`, or
 * an unterminated quote.
 */
export const commandSegments = (command: string): string[][] | null => {
  const segments: string[][] = [];
  let current: string[] = [];
  let token = '';
  let hasToken = false;
  let quote: '"' | "'" | null = null;
  let advanced = false;

  const pushToken = () => {
    if (hasToken) {
      if (current.length === 0 && /^[A-Za-z_][\w]*=/.test(token)) advanced = true;
      current.push(token);
    }
    token = '';
    hasToken = false;
  };
  const pushSegment = () => {
    pushToken();
    if (current.length) segments.push(current);
    current = [];
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    if (quote) {
      if (char === quote) quote = null;
      else {
        if (quote === '"' && (char === '$' || char === '`')) advanced = true;
        token += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      hasToken = true;
      continue;
    }
    if (char === '|' || char === ';' || char === '&' || char === '(' || char === ')' || char === '\n' || char === '\r') {
      pushSegment();
      // `&&`, `||` and `|&` are one operator.
      const next = command[index + 1];
      if ((char === '&' || char === '|') && (next === '&' || next === '|')) index += 1;
      continue;
    }
    if (/\s/.test(char)) {
      pushToken();
      continue;
    }
    if (ADVANCED_CHARS.has(char)) advanced = true;
    token += char;
    hasToken = true;
  }
  if (quote || advanced) return null;
  pushSegment();
  return segments.length ? segments : null;
};

const sameToken = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

const startsWithPrefix = (segment: readonly string[], prefix: readonly string[]): boolean =>
  prefix.length > 0 && prefix.length <= segment.length && prefix.every((part, index) => sameToken(part, segment[index]!));

/** Whether every segment of `command` is allowed by one of `rules`. */
export const allowedByRules = (command: string, rules: readonly (readonly string[])[]): boolean => {
  if (!rules.length) return false;
  const segments = commandSegments(command);
  if (!segments) return false;
  return segments.every((segment) => rules.some((rule) => startsWithPrefix(segment, rule)));
};

/* ------------------------------------------------------------------------ */
/* Which prefixes may be offered                                             */
/* ------------------------------------------------------------------------ */

/** Prefixes that would let a rule run arbitrary code or destroy data: never offered. */
const INTERPRETERS = new Set(['python', 'python3', 'py', 'node', 'deno', 'bun', 'ruby', 'perl', 'php', 'bash', 'sh', 'zsh', 'pwsh', 'powershell', 'cmd', 'cmd.exe', 'powershell.exe', 'pwsh.exe', 'iex', 'invoke-expression', 'start-process', 'sudo', 'su', 'env', 'xargs', 'eval', 'exec', 'npx', 'pnpx', 'bunx', 'uvx']);
const DESTRUCTIVE = new Set(['rm', 'rmdir', 'del', 'erase', 'rd', 'remove-item', 'ri', 'format', 'mkfs', 'dd', 'shred', 'git-clean', 'diskpart', 'reg', 'takeown', 'icacls', 'chmod', 'chown', 'kill', 'taskkill', 'stop-process', 'shutdown', 'restart-computer']);

/**
 * The prefix the user may approve for later commands: the model's `prefix_rule`
 * when it is a safe one, else a sensible two-word prefix of the command itself,
 * else none.
 */
export const offeredPrefix = (command: string, requested?: unknown): string[] | undefined => {
  const segments = commandSegments(command);
  if (!segments || segments.length !== 1) return undefined;
  const segment = segments[0]!;
  const valid = (prefix: string[]): boolean => {
    if (!prefix.length || !startsWithPrefix(segment, prefix)) return false;
    const head = prefix[0]!.toLowerCase().replace(/\.exe$/, '');
    if (DESTRUCTIVE.has(head) || INTERPRETERS.has(head)) return false;
    if (head === 'git' && prefix.length < 2) return false;
    if (prefix.length === 1 && segment.length > 1 && /^(npm|pnpm|yarn|cargo|go|dotnet|gh|docker|kubectl|pip|pip3|uv|poetry|mvn|gradle|make)$/.test(head)) return false;
    return true;
  };
  if (Array.isArray(requested)) {
    const prefix = requested.filter((part): part is string => typeof part === 'string' && part.trim() !== '').map((part) => part.trim());
    if (prefix.length === requested.length && valid(prefix)) return prefix;
  }
  const head = segment[0]!.toLowerCase().replace(/\.exe$/, '');
  if (DESTRUCTIVE.has(head) || INTERPRETERS.has(head)) return undefined;
  const fallback = segment.length > 1 && !segment[1]!.startsWith('-') ? segment.slice(0, 2) : segment.slice(0, 1);
  return valid(fallback) ? fallback : undefined;
};
