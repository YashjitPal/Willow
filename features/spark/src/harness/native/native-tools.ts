/**
 * Spark's tools in the desktop app's native runtime.
 *
 * `exec_command` and `write_stdin` are Codex's unified exec, run by the local
 * companion with Codex's parameters, yields and output format; the observation
 * the model reads is the companion's response text, unchanged. `run_command`
 * stays so a chat that used it keeps working, and runs the same way.
 *
 * `read_file`, `list_files` and `search_files` replace the web runtime's tools of
 * the same ids with ones that read the real disk. They never ask for approval:
 * reading is not gated in Codex either, and they spare the model a shell round
 * (and the user an approval) for every file it looks at.
 */

import { nextId } from '../runtime/tools';
import type { CommandCall, SearchHit, ToolContext, ToolHandler, ToolResult } from '../runtime/protocol';
import { allowedByRules, offeredPrefix, type NativeApprovals } from './native-approvals';
import type { NativeExecResponse, SparkNativeHost } from './native-host';
import type { NativePaths } from './native-paths';

export const EXEC_REJECTED = 'exec command rejected by user';
/** Codex's answer to an escalation request when the approval policy is `never`. */
export const ESCALATION_REJECTED =
  'approval policy is Never; reject command — you cannot ask for escalated permissions if the approval policy is Never';

const MAX_PREVIEW_LINES = 400;
const MAX_SEARCH_HITS = 40;
const DEFAULT_LIST_DEPTH = 2;

export interface NativeToolOptions {
  host: SparkNativeHost;
  paths: NativePaths;
  approvals: NativeApprovals;
  /** Owns the task's processes, so stopping the task can stop them. */
  owner: string;
  /** The shell's name, shown on command rows. */
  shell: string;
  onCapability?: (name: string) => void;
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
const asNumber = (value: unknown): number | undefined => {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined;
};
const asBoolean = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
/** A folder as shown back: the working folder by its full path, anything inside it relative. */
const folderLabel = (paths: NativePaths, folder: string): string => {
  const shown = paths.display(folder);
  return shown === '.' ? paths.cwd : shown;
};

/* ------------------------------------------------------------------------ */
/* Commands                                                                  */
/* ------------------------------------------------------------------------ */

/** Running sessions by owner, so a later turn's `write_stdin` row can name its command. */
const sessionsByOwner = new Map<string, Map<number, { command: string; cwd: string }>>();
const sessionsOf = (owner: string) => {
  let sessions = sessionsByOwner.get(owner);
  if (!sessions) sessionsByOwner.set(owner, (sessions = new Map()));
  return sessions;
};

/** Settles with `promise`, or rejects as soon as `signal` aborts after running `onAbort`. */
const untilAborted = <T>(promise: Promise<T>, signal: AbortSignal | undefined, onAbort: () => void): Promise<T> => {
  if (!signal) return promise;
  if (signal.aborted) {
    onAbort();
    return Promise.reject(new Error('aborted by user'));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      onAbort();
      reject(new Error('aborted by user'));
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
};

const statusFor = (response: NativeExecResponse): CommandCall['status'] =>
  response.exitCode == null || response.exitCode === 0 ? 'success' : 'error';

interface ExecRequest {
  cmd: string;
  workdir?: unknown;
  shell?: unknown;
  login?: unknown;
  yieldTimeMs?: unknown;
  maxOutputTokens?: unknown;
  sandboxPermissions?: unknown;
  justification?: unknown;
  prefixRule?: unknown;
}

async function runExec(options: NativeToolOptions, context: ToolContext, request: ExecRequest): Promise<ToolResult> {
  const { host, paths, approvals } = options;
  let cwd: string;
  try {
    cwd = asString(request.workdir).trim() ? paths.resolve(asString(request.workdir)) : paths.cwd;
  } catch (error) {
    return { observation: messageOf(error), failed: true };
  }

  const escalating = request.sandboxPermissions === 'require_escalated' || request.sandboxPermissions === 'with_additional_permissions';
  if (escalating && approvals.mode() === 'full') return { observation: ESCALATION_REJECTED, failed: true };

  const needsApproval = approvals.mode() === 'ask' && !allowedByRules(request.cmd, approvals.rules());
  options.onCapability?.('run_command');
  const id = context.emit({
    id: nextId('call'),
    kind: 'command',
    status: needsApproval ? 'queued' : 'running',
    startedAt: Date.now(),
    command: request.cmd,
    cwd: paths.display(cwd),
    output: [],
    shell: options.shell,
  });

  if (needsApproval) {
    const prefixRule = offeredPrefix(request.cmd, request.prefixRule);
    const decision = await approvals.request({
      kind: 'command',
      command: request.cmd,
      cwd,
      justification: asString(request.justification).trim() || undefined,
      prefixRule,
    }, context.signal);
    if (decision === 'deny') {
      context.patch(id, { status: 'cancelled', endedAt: Date.now(), error: 'Not run' });
      return { observation: EXEC_REJECTED, failed: true };
    }
    if (decision === 'prefix' && prefixRule) approvals.addRule(prefixRule);
    if (decision === 'task') approvals.allowAll();
    context.patch(id, { status: 'running', startedAt: Date.now() });
  }

  try {
    const response = await untilAborted(host.execStart({
      cmd: request.cmd,
      workdir: cwd,
      shell: asString(request.shell).trim() || undefined,
      login: asBoolean(request.login),
      yieldTimeMs: asNumber(request.yieldTimeMs),
      maxOutputTokens: asNumber(request.maxOutputTokens),
      owner: options.owner,
    }), context.signal, () => void host.execKill({ owner: options.owner }).catch(() => undefined));
    if (response.sessionId != null) sessionsOf(options.owner).set(response.sessionId, { command: request.cmd, cwd });
    context.patch(id, {
      status: statusFor(response),
      endedAt: Date.now(),
      output: response.output ? [{ stream: 'stdout', text: response.output }] : [],
      ...(response.exitCode != null ? { exitCode: response.exitCode } : {}),
    } as Partial<CommandCall>);
    return { observation: response.text, mutated: true };
  } catch (error) {
    const message = messageOf(error);
    context.patch(id, { status: context.signal?.aborted ? 'cancelled' : 'error', endedAt: Date.now(), error: message });
    return { observation: `exec_command failed: ${message}`, failed: true };
  }
}

const execCommand = (options: NativeToolOptions): ToolHandler => ({
  id: 'exec_command',
  async run(args, context) {
    const cmd = asString(args.cmd ?? args.command);
    if (!cmd.trim()) return { observation: 'exec_command requires a "cmd" argument.', failed: true };
    return runExec(options, context, {
      cmd,
      workdir: args.workdir,
      shell: args.shell,
      login: args.login,
      yieldTimeMs: args.yield_time_ms,
      maxOutputTokens: args.max_output_tokens,
      sandboxPermissions: args.sandbox_permissions,
      justification: args.justification,
      prefixRule: args.prefix_rule,
    });
  },
});

/** The web runtime's `run_command`, kept so a chat that used it still works here. */
const runCommand = (options: NativeToolOptions): ToolHandler => ({
  id: 'run_command',
  async run(args, context) {
    const cmd = asString(args.command ?? args.cmd);
    if (!cmd.trim()) return { observation: 'run_command requires a command.', failed: true };
    return runExec(options, context, { cmd, workdir: args.cwd ?? args.workdir, yieldTimeMs: args.timeoutMs ?? args.yield_time_ms });
  },
});

const writeStdin = (options: NativeToolOptions): ToolHandler => ({
  id: 'write_stdin',
  async run(args, context) {
    const sessionId = asNumber(args.session_id);
    if (sessionId == null) return { observation: 'write_stdin requires a "session_id" argument.', failed: true };
    const chars = typeof args.chars === 'string' ? args.chars : '';
    const sessions = sessionsOf(options.owner);
    const known = sessions.get(sessionId);
    const id = context.emit({
      id: nextId('call'),
      kind: 'command',
      status: 'running',
      startedAt: Date.now(),
      command: known?.command ?? '',
      cwd: known ? options.paths.display(known.cwd) : '',
      output: [],
      shell: options.shell,
      interaction: chars ? 'write' : 'wait',
    });
    try {
      const response = await untilAborted(options.host.execWrite({
        sessionId,
        chars,
        yieldTimeMs: asNumber(args.yield_time_ms),
        maxOutputTokens: asNumber(args.max_output_tokens),
      }), context.signal, () => void options.host.execKill({ owner: options.owner }).catch(() => undefined));
      if (response.sessionId == null) sessions.delete(sessionId);
      context.patch(id, {
        status: statusFor(response),
        endedAt: Date.now(),
        output: response.output ? [{ stream: 'stdout', text: response.output }] : [],
        ...(response.exitCode != null ? { exitCode: response.exitCode } : {}),
      } as Partial<CommandCall>);
      return { observation: response.text, mutated: true };
    } catch (error) {
      const message = messageOf(error);
      context.patch(id, { status: context.signal?.aborted ? 'cancelled' : 'error', endedAt: Date.now(), error: message });
      return { observation: `write_stdin failed: ${message}`, failed: true };
    }
  },
});

/* ------------------------------------------------------------------------ */
/* Files                                                                     */
/* ------------------------------------------------------------------------ */

const readFile = (options: NativeToolOptions): ToolHandler => ({
  id: 'read_file',
  async run(args, context) {
    const raw = asString(args.path);
    if (!raw.trim()) return { observation: 'read_file requires a "path" argument.', failed: true };
    let path: string;
    try {
      path = options.paths.resolve(raw);
    } catch (error) {
      return { observation: messageOf(error), failed: true };
    }
    const shown = options.paths.display(path);
    let file;
    try {
      [file] = await options.host.read([path]);
    } catch (error) {
      return { observation: messageOf(error), failed: true };
    }
    if (!file?.exists) return { observation: `No file at ${shown}.`, failed: true };
    if (file.isDirectory) return { observation: `${shown} is a folder. Use list_files to see what is in it.`, failed: true };
    if (file.binary) return { observation: `${shown} is a binary file (${file.size ?? 0} bytes) and cannot be read as text.`, failed: true };
    if (file.tooLarge || typeof file.text !== 'string') {
      return { observation: `${shown} is too large to read whole (${file.size ?? 0} bytes). Read part of it with a command instead.`, failed: true };
    }

    const all = file.text.replace(/^\uFEFF/, '').split(/\r?\n/);
    const start = Math.max(1, Math.floor(asNumber(args.start_line) ?? 1));
    const end = Math.min(all.length, Math.floor(asNumber(args.end_line) ?? all.length));
    const slice = all.slice(start - 1, end).slice(0, MAX_PREVIEW_LINES);
    const id = context.emit({
      id: nextId('call'),
      kind: 'read',
      status: 'running',
      startedAt: Date.now(),
      path: shown,
      range: [start, start + slice.length - 1],
      totalLines: all.length,
      preview: slice.slice(0, 24),
    });
    context.patch(id, { status: 'success', endedAt: Date.now() });
    const numbered = slice.map((line, index) => `${String(start + index).padStart(5)}  ${line}`).join('\n');
    const truncated = slice.length < end - start + 1 ? `\n\n[truncated at ${MAX_PREVIEW_LINES} lines; request a narrower range]` : '';
    return { observation: `${shown} (${all.length} lines)\n\n${numbered}${truncated}` };
  },
});

const listFiles = (options: NativeToolOptions): ToolHandler => ({
  id: 'list_files',
  async run(args, context) {
    let root: string;
    try {
      root = asString(args.path).trim() ? options.paths.resolve(asString(args.path)) : options.paths.cwd;
    } catch (error) {
      return { observation: messageOf(error), failed: true };
    }
    const depth = Math.min(Math.max(Math.floor(asNumber(args.depth) ?? DEFAULT_LIST_DEPTH), 1), 6);
    let listing;
    try {
      listing = await options.host.list(root, depth);
    } catch (error) {
      return { observation: messageOf(error), failed: true };
    }
    const shown = folderLabel(options.paths, root);
    if (!listing.entries.length) return { observation: `${shown} is empty.` };
    const id = context.emit({
      id: nextId('call'),
      kind: 'list',
      status: 'running',
      startedAt: Date.now(),
      path: shown,
      entries: listing.entries.map((entry) => ({ name: entry.path, type: entry.type, ...(entry.size != null ? { size: entry.size } : {}) })),
    });
    context.patch(id, { status: 'success', endedAt: Date.now() });
    const lines = listing.entries.map((entry) => {
      if (entry.type === 'dir') return `  ${entry.path}/${entry.skipped ? '  (not listed)' : ''}`;
      return `  ${entry.path}  (${entry.size ?? 0} bytes)`;
    });
    const note = listing.truncated ? '\n[listing truncated; list a subfolder]' : '';
    return { observation: `${shown}: ${listing.entries.length} entries, ${depth} level(s) deep\n${lines.join('\n')}${note}` };
  },
});

const searchFiles = (options: NativeToolOptions): ToolHandler => ({
  id: 'search_files',
  async run(args, context) {
    const query = asString(args.query ?? args.pattern);
    if (!query) return { observation: 'search_files requires a "query" argument.', failed: true };
    const regex = args.regex === true;
    if (regex) {
      try {
        new RegExp(query, 'i');
      } catch (error) {
        return { observation: `Invalid regular expression: ${messageOf(error)}`, failed: true };
      }
    }
    let root: string;
    try {
      root = asString(args.path).trim() ? options.paths.resolve(asString(args.path)) : options.paths.cwd;
    } catch (error) {
      return { observation: messageOf(error), failed: true };
    }
    let result;
    try {
      result = await options.host.search(root, query, regex);
    } catch (error) {
      return { observation: messageOf(error), failed: true };
    }
    const shown = (relative: string) => options.paths.display(options.paths.resolve(relative, root));
    const matcher = regex ? new RegExp(query, 'i') : null;
    const hits: SearchHit[] = result.matches.slice(0, MAX_SEARCH_HITS).map((match) => {
      const at = matcher ? match.text.search(matcher) : match.text.toLowerCase().indexOf(query.toLowerCase());
      const length = matcher ? (match.text.match(matcher)?.[0].length ?? 0) : query.length;
      return { path: shown(match.path), line: match.line, text: match.text, match: [Math.max(at, 0), Math.max(at, 0) + length] };
    });
    const fileCount = new Set(result.matches.map((match) => match.path)).size;
    const id = context.emit({
      id: nextId('call'),
      kind: 'search',
      status: 'running',
      startedAt: Date.now(),
      query,
      scope: folderLabel(options.paths, root),
      hits,
      fileCount,
    });
    context.patch(id, { status: 'success', endedAt: Date.now() });
    if (!hits.length) return { observation: `No matches for ${JSON.stringify(query)} in ${folderLabel(options.paths, root)}.` };
    const rendered = hits.map((hit) => (hit.line ? `${hit.path}:${hit.line}: ${hit.text}` : `${hit.path} (file name)`)).join('\n');
    const truncated = result.truncated || result.matches.length > hits.length ? '\n[results truncated; narrow the query or the path]' : '';
    return { observation: `${hits.length} match(es) in ${fileCount} file(s):\n${rendered}${truncated}` };
  },
});

/**
 * The tools above as function declarations, so the model sees a terminal among its
 * tools as Codex's model does. A function call reaches the same handler as the
 * `*** Call:` envelope, approvals included.
 *
 * `exec_command` and `write_stdin` carry Codex's schemas (`shell_spec.rs`), less
 * `tty` (sessions here are pipes) and `sandbox_permissions` (there is no sandbox),
 * with `justification` and `prefix_rule` described for the approval this runtime
 * asks instead.
 */
export const nativeToolDeclarations = (platform: string): { functionDeclarations: Record<string, unknown>[] } => ({
  functionDeclarations: [
    {
      name: 'exec_command',
      description: 'Runs a command in the user\'s shell on this computer, returning its output, or a session ID for a command still running.',
      parameters: {
        type: 'OBJECT',
        properties: {
          cmd: { type: 'STRING', description: 'Shell command to execute.' },
          workdir: { type: 'STRING', description: 'Working directory for the command. Defaults to the turn cwd.' },
          yield_time_ms: {
            type: 'NUMBER',
            description: platform === 'win32'
              ? 'Maximum time to wait before returning a session ID for a still-running command. Commands that finish sooner return immediately. For ordinary commands, omit this parameter to use the 10000 ms default. Effective range on Windows is 10000-30000 ms.'
              : 'Wait before yielding output. Defaults to 10000 ms; effective range is 250-30000 ms.',
          },
          max_output_tokens: { type: 'NUMBER', description: 'Output token budget. Defaults to 10000 tokens; larger requests may be capped by policy.' },
          shell: { type: 'STRING', description: 'Shell binary to launch. Defaults to the user\'s default shell.' },
          login: { type: 'BOOLEAN', description: 'True runs the shell with -l/-i semantics; false disables them. Defaults to true.' },
          justification: { type: 'STRING', description: 'When the command needs the user\'s approval: one short question shown to them, such as "Do you want to install the project\'s dependencies?".' },
          prefix_rule: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'A reusable prefix of `cmd` the user may approve for later commands, for example ["npm", "test"]. Never an interpreter or a destructive command.',
          },
        },
        required: ['cmd'],
      },
    },
    {
      name: 'write_stdin',
      description: 'Writes characters to an existing unified exec session and returns recent output.',
      parameters: {
        type: 'OBJECT',
        properties: {
          session_id: { type: 'NUMBER', description: 'Identifier of the running unified exec session.' },
          chars: { type: 'STRING', description: 'Bytes to write to stdin. Defaults to empty, which polls without writing.' },
          yield_time_ms: { type: 'NUMBER', description: 'Wait before yielding output. Non-empty writes default to 250 ms and cap at 30000 ms; empty polls wait 5000-300000 ms by default.' },
          max_output_tokens: { type: 'NUMBER', description: 'Output token budget. Defaults to 10000 tokens; larger requests may be capped by policy.' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'read_file',
      description: 'Reads a text file on this computer, with line numbers. Never needs approval.',
      parameters: {
        type: 'OBJECT',
        properties: {
          path: { type: 'STRING', description: 'Relative to the cwd, or absolute.' },
          start_line: { type: 'INTEGER', description: 'First line to read, from 1.' },
          end_line: { type: 'INTEGER', description: 'Last line to read.' },
        },
        required: ['path'],
      },
    },
    {
      name: 'list_files',
      description: 'Lists a folder on this computer, skipping dependency and build folders. Never needs approval.',
      parameters: {
        type: 'OBJECT',
        properties: {
          path: { type: 'STRING', description: 'Relative to the cwd, or absolute. Defaults to the cwd.' },
          depth: { type: 'INTEGER', description: 'How many levels deep, 1-6. Defaults to 2.' },
        },
      },
    },
    {
      name: 'search_files',
      description: 'Searches file names and contents under a folder on this computer. Never needs approval.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: 'Text to find, case-insensitive.' },
          path: { type: 'STRING', description: 'Folder or file to search, relative to the cwd or absolute. Defaults to the cwd.' },
          regex: { type: 'BOOLEAN', description: 'Treat the query as a regular expression.' },
        },
        required: ['query'],
      },
    },
  ],
});

/** The native runtime's tools, which replace the web runtime's tools of the same ids. */
export const createNativeTools = (options: NativeToolOptions): ToolHandler[] => [
  execCommand(options),
  writeStdin(options),
  runCommand(options),
  readFile(options),
  listFiles(options),
  searchFiles(options),
];

/** Forgets a task's running sessions, once they have been stopped. */
export const forgetNativeSessions = (owner: string): void => {
  sessionsByOwner.delete(owner);
};
