/**
 * What a bot can do on the user's own computer, once they connect a folder.
 * Every name starts with `user_`, so none can be mistaken for the bot's own
 * computer (machine-tools.ts), where nothing waits for approval.
 *
 * - `user_files` looks — lists, reads, searches — inside that folder without
 *   asking. It cannot change anything, and files that look like they hold
 *   secrets stay out of reach.
 * - `user_apply_patch` edits files there with Codex's patch format, at once, as
 *   Codex's workspace-write mode does, and shows what changed as a card.
 *   Deleting and moving stay with approved commands.
 * - A command whose prefix the user approved for good there (Codex's prefix
 *   rules) runs without a card.
 * - `user_run_command` and `user_start_job` never run anything. They record an
 *   approval request — the exact command, the folder it is confined to, and
 *   why — which the conversation shows as a card with Approve and Deny. On
 *   approval the runtime runs *that* command (runtime/computer-access.ts), so
 *   what runs is always exactly what the user read, never something re-planned
 *   afterwards.
 * - `user_check_job` and `user_stop_job` follow the background jobs the user approved.
 */
import { allowedByRules, offeredPrefix } from '../../../harness/native/native-approvals';
import { applyPatch, parsePatch, PatchParseError, type FileChange, type PatchOp } from '../../../harness/runtime/apply-patch';
import { describeOutput } from '../runtime/command-output';
import { computerProblem, type DotComputerBridge, type DotFileContent } from '../runtime/computer-bridge';
import { withWebLock } from '../runtime/web-lock';
import { appendDotItem, getDotThread, updateDotRuntime, type DotItemDraft } from '../thread/thread-store';
import type { DotCommandApproval, DotEditRecord, DotItem, DotJob, DotThread } from '../thread/thread-types';
import { fail, ok, permissionsNow, stringArg, type DotToolEntry, type DotToolEnv } from './tool-env';

const DEFAULT_TIMEOUT_SECONDS = 60;
const MAX_TIMEOUT_SECONDS = 120;
const MAX_TOOL_OUTPUT_CHARS = 16_000;

export type DotComputerEnv = DotToolEnv & { computer: { root: string; shell: string; bridge: DotComputerBridge; whole?: boolean; home?: string } };

/** What the user connected: a folder (`root`), or the whole computer, reached from their `home`. */
export type DotComputerScope = { root: string; whole?: boolean; home?: string };

const approvalSteps = (thread: DotThread, approvalId: string): DotItem[] =>
  thread.items.filter((item) => item.kind === 'event' && item.event === 'approval' && item.ref === approvalId);

/** The user's answer to an approval (approved, started, declined or withdrawn), or undefined while it is waiting. */
export const approvalDecision = (thread: DotThread, approvalId: string): DotItem | undefined =>
  approvalSteps(thread, approvalId).find((item) => item.approvalStep !== 'finished');

/** What happened when an approved command ran, once it has. */
export const approvalOutcome = (thread: DotThread, approvalId: string): DotItem | undefined =>
  approvalSteps(thread, approvalId).find((item) => item.approvalStep === 'finished');

/** Approval requests still waiting for the user. */
export const pendingApprovals = (thread: DotThread): DotItem[] =>
  thread.items.filter((item) => item.kind === 'approval' && !approvalDecision(thread, item.id));

/** Approved commands with no outcome recorded: running now, or lost when the window running them closed. */
export const unfinishedApprovals = (thread: DotThread): DotItem[] =>
  thread.items.filter((item) => item.kind === 'approval' && approvalDecision(thread, item.id)?.approvalStep === 'approved' && !approvalOutcome(thread, item.id));

/** `"."` or a relative path that stays inside the connected folder; null for anything that would leave it. */
const relativePath = (raw: string | undefined): string | null => {
  const value = (raw ?? '.').trim().replace(/\\/g, '/') || '.';
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value) || value.startsWith('~')) return null;
  const parts = value.split('/').filter((part) => part && part !== '.');
  if (parts.includes('..')) return null;
  return parts.length ? parts.join('/') : '.';
};

const splitParts = (value: string): string[] | null => {
  const parts = value.replace(/\\/g, '/').split('/').filter((part) => part && part !== '.');
  return parts.includes('..') ? null : parts;
};

/** An absolute path as its root — a drive, `C:\`, or `/` — and the parts after it; null for a path that is not absolute. */
const absoluteParts = (value: string): { root: string; parts: string[] } | null => {
  const drive = /^([a-zA-Z]):(?:[\\/](.*))?$/.exec(value);
  const parts = drive ? splitParts(drive[2] ?? '') : value.startsWith('/') ? splitParts(value) : null;
  if (!parts) return null;
  return { root: drive ? `${drive[1]!.toUpperCase()}:\\` : '/', parts };
};

const samePart = (root: string, a: string, b: string): boolean => (root === '/' ? a === b : a.toLowerCase() === b.toLowerCase());

/**
 * Where a path the bot gave is: the folder to reach it through, and the path inside that, relative. With a folder
 * connected, anything inside it, written relative to it or in full; with the whole computer, any absolute path on
 * any drive, `~` for the user's home, and other paths from their home. Null for anything out of reach.
 */
export const locatePath = (scope: DotComputerScope, raw: string | undefined): { root: string; path: string } | null => {
  const value = (raw ?? '').trim() || '.';
  if (scope.whole) {
    const home = scope.home ?? scope.root;
    const full = value === '.' || value === '~' ? home : /^~[\\/]/.test(value) ? `${home}/${value.slice(2)}` : absoluteParts(value) ? value : `${home}/${value}`;
    const absolute = absoluteParts(full);
    return absolute ? { root: absolute.root, path: absolute.parts.length ? absolute.parts.join('/') : '.' } : null;
  }
  const absolute = absoluteParts(value);
  if (absolute) {
    const base = absoluteParts(scope.root);
    if (!base || base.root !== absolute.root || base.parts.length > absolute.parts.length) return null;
    if (!base.parts.every((part, index) => samePart(base.root, part, absolute.parts[index]!))) return null;
    const rest = absolute.parts.slice(base.parts.length);
    return { root: scope.root, path: rest.length ? rest.join('/') : '.' };
  }
  const path = relativePath(value);
  return path === null ? null : { root: scope.root, path };
};

/** A located path as the bot reads it back: in full with the whole computer connected, relative to a folder otherwise. */
export const shownPath = (scope: DotComputerScope, root: string, path: string): string => {
  if (path === '.') return root;
  if (!scope.whole) return path;
  const separator = root === '/' ? '/' : '\\';
  return `${root.replace(/[\\/]+$/, '')}${separator}${path.split('/').join(separator)}`;
};

/** The folder that holds every one of `paths` (full paths), for a card listing what changed in it. */
const commonFolder = (paths: string[]): string => {
  const separator = paths[0]?.includes('\\') ? '\\' : '/';
  const split = paths.map((path) => path.split(/[\\/]/).slice(0, -1));
  const first = split[0] ?? [];
  let length = first.length;
  for (const parts of split) {
    length = Math.min(length, parts.length);
    while (length > 0 && parts.slice(0, length).join('\u0000').toLowerCase() !== first.slice(0, length).join('\u0000').toLowerCase()) length -= 1;
  }
  const folder = first.slice(0, length).join(separator);
  return folder === '' ? '/' : /^[A-Za-z]:$/.test(folder) ? `${folder}\\` : folder;
};

/**
 * Files that usually hold credentials: environment files (except the shared
 * templates), keys and certificates, and the folders tools keep secrets in —
 * and, with the whole computer reachable, browsers' profiles, the system's
 * credential stores and Willow's own data.
 */
const SECRET_PATH = /(^|\/)(\.env(\.(?!(example|sample|template|defaults?)$)[^/]+)?|\.npmrc|\.pypirc|\.netrc|\.pgpass|\.git-credentials|id_(rsa|dsa|ecdsa|ed25519)|credentials(\.[^/]+)?|secrets?(\.[^/]+)?)$|\.(pem|key|p12|pfx|jks|keystore|kdbx|ppk|gpg)$|(^|\/)\.(ssh|aws|gnupg|azure|kube|docker)(\/|$)|(^|\/)AppData\/(Local|Roaming)\/(Google\/Chrome|Microsoft\/Edge|BraveSoftware|Mozilla|Opera Software|Vivaldi|Microsoft\/(Credentials|Protect|Vault)|com\.willow\.[^/]+|Willow)(\/|$)|(^|\/)Library\/(Keychains|Cookies|Application Support\/(Google\/Chrome|Firefox|BraveSoftware))(\/|$)|(^|\/)\.(mozilla|config\/(google-chrome|chromium|BraveSoftware))(\/|$)/i;

export const isSecretPath = (path: string): boolean => SECRET_PATH.test(path.replace(/\\/g, '/'));

const clip = (text: string): string =>
  text.length <= MAX_TOOL_OUTPUT_CHARS ? text : `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n[… ${(text.length - MAX_TOOL_OUTPUT_CHARS).toLocaleString('en-US')} more characters]`;

const size = (bytes = 0): string => {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
};

const stillConnected = (env: DotComputerEnv): boolean => getDotThread(env.dotId)?.runtime.computer?.root === env.computer.root;

const DISCONNECTED = 'The user has disconnected that folder; you can no longer reach it.';

/** A command's folder, as the user reads it on its card and the bot in its result. */
const commandPlace = (request: Pick<DotCommandApproval, 'root' | 'cwd'>): string => {
  if (request.cwd === '.') return request.root;
  const separator = /^[A-Za-z]:/.test(request.root) ? '\\' : '/';
  return `${request.root.replace(/[\\/]+$/, '')}${separator}${request.cwd.split('/').join(separator)}`;
};

/**
 * The user lets the bot act without asking, or allows commands like this one for good: the command runs now — a
 * background one starts — and its record in Activity is written as the steps of an approval the user gave in advance.
 * Those steps tell the bot nothing it does not learn from the tool's result, so they never wake it; a background
 * job's end still does.
 */
const runAtOnce = async (env: DotComputerEnv, request: DotCommandApproval, turnId: string, because: 'mode' | 'rule' = 'mode') => {
  const where = commandPlace(request);
  const record = () => appendDotItem(env.dotId, { kind: 'approval', text: request.command, turnId, approval: request });
  const step = (ref: string, draft: Omit<DotItemDraft, 'kind'>) => appendDotItem(env.dotId, { kind: 'event', event: 'approval', ref, quiet: true, ...draft });

  // A job's card is written once it has started, so it never stands waiting for a decision.
  if (request.background) {
    let job: Awaited<ReturnType<DotComputerBridge['startJob']>> | { problem: string };
    try {
      job = await env.computer.bridge.startJob({ root: request.root, cwd: request.cwd, command: request.command });
    } catch (error) {
      job = { problem: computerProblem(error) };
    }
    const item = record();
    if ('problem' in job) {
      const report = `\`${request.command}\` (${item.id}) could not start: ${job.problem}`;
      step(item.id, { approvalStep: 'approved', text: `\`${request.command}\` (${item.id}) was to start in ${where}.` });
      step(item.id, { approvalStep: 'finished', failed: true, text: report });
      return fail(report);
    }
    const { jobId, startedAt } = job;
    updateDotRuntime(env.dotId, (runtime) => ({
      ...runtime,
      jobs: [...(runtime.jobs ?? []), { id: item.id, jobId, command: request.command, root: request.root, cwd: request.cwd, startedAt: startedAt || env.now(), status: 'running' as const }].slice(-30),
    }));
    step(item.id, { approvalStep: 'started', text: `\`${request.command}\` (${item.id}) is running in the background in ${where}.` });
    return ok(`Started \`${request.command}\` in the background in ${where} (${item.id}), as the user lets you act without asking. You will hear when it ends; read its output with user_check_job and stop it with user_stop_job.`);
  }

  const item = record();
  step(item.id, { approvalStep: 'approved', text: `\`${request.command}\` (${item.id}) is running in ${where}.` });
  let report = `\`${request.command}\` (${item.id}) could not run.`;
  let failed = true;
  // Held while it runs, as an approved command's lock is: a window opening meanwhile does not take it for lost.
  await withWebLock(`willow-dot-command:${item.id}`, async () => {
    try {
      const output = await env.computer.bridge.execute({ root: request.root, cwd: request.cwd, command: request.command, timeoutMs: request.timeoutSeconds * 1_000 });
      failed = output.code !== 0;
      report = `\`${request.command}\` (${item.id}) ${describeOutput(output, request.timeoutSeconds)}`;
    } catch (error) {
      report = `\`${request.command}\` (${item.id}) could not run: ${computerProblem(error)}`;
    }
    step(item.id, { approvalStep: 'finished', failed, text: report });
  });
  const result = because === 'rule' ? `${clip(report)} (The user allows commands like this here without asking.)` : clip(report);
  return failed ? fail(result) : ok(result);
};

/**
 * Records a request for the user to approve, after checking it can be asked at all — or, for a command whose prefix
 * the user approved for good in this folder, runs it now and returns its output. With the user letting the bot act
 * without asking, it runs at once (`runAtOnce`).
 */
const requestApproval = async (env: DotComputerEnv, args: Record<string, unknown>, turnId: string, background: boolean) => {
  const command = stringArg(args, 'command');
  if (!command) return fail('Give the "command" to run.');
  if (command.length > 20_000) return fail('That command is too long to run.');
  const reason = stringArg(args, 'reason');
  if (!reason) return fail('Say in "reason" why you need to run it, in words the user will understand. They read it before approving.');
  const place = locatePath(env.computer, stringArg(args, 'cwd'));
  if (place === null) {
    return fail(env.computer.whole ? '"cwd" must be a folder: its full path, or one relative to the user\'s home folder.' : `"cwd" must be a folder inside ${env.computer.root}, written relative to it.`);
  }
  const { root, path: cwd } = place;
  const timeoutSeconds = background
    ? 0
    : Math.max(1, Math.min(MAX_TIMEOUT_SECONDS, Math.round(Number(args.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS)) || DEFAULT_TIMEOUT_SECONDS));

  const thread = getDotThread(env.dotId);
  if (!thread || !stillConnected(env)) return fail(DISCONNECTED);
  if (permissionsNow(env) === 'act') return runAtOnce(env, { command, cwd, root, reason, timeoutSeconds, ...(background ? { background: true } : {}) }, turnId);
  const duplicate = pendingApprovals(thread).find((item) => item.approval?.command === command && item.approval.root === root && item.approval.cwd === cwd && Boolean(item.approval.background) === background);
  if (duplicate) return ok(`You already asked to run this (${duplicate.id}); it is still waiting for the user.`);

  if (!background && allowedByRules(command, thread.runtime.computer?.rules ?? [])) {
    return runAtOnce(env, { command, cwd, root, reason, timeoutSeconds }, turnId, 'rule');
  }

  const prefix = background ? undefined : offeredPrefix(command, args.prefix_rule);
  const item = appendDotItem(env.dotId, {
    kind: 'approval',
    text: command,
    turnId,
    approval: { command, cwd, root, reason, timeoutSeconds, ...(background ? { background: true } : {}), ...(prefix ? { prefix } : {}) },
  });
  return ok(background
    ? `Asked the user to approve starting this in the background (${item.id}). Nothing has run yet: you will hear when they decide, when it starts and when it ends. Carry on with anything that does not depend on it, or end your turn.`
    : `Asked the user to approve this (${item.id}). Nothing has run yet: their decision, and the output if it runs, will reach you as an event. Carry on with anything that does not depend on it, or end your turn.`);
};

/** Where the tools reach, for their descriptions: the connected folder, or the whole computer from the user's home. */
const reach = (env: DotComputerEnv): { where: string; paths: string } => (env.computer.whole
  ? { where: 'anywhere on it', paths: `a full path, or one relative to the user's home folder (${env.computer.home ?? env.computer.root})` }
  : { where: `inside ${env.computer.root}`, paths: 'relative to that folder' });

const runCommandTool = (env: DotComputerEnv): DotToolEntry => ({
  doc: {
    name: 'user_run_command',
    args: env.permissions === 'act' ? '{"command": "…", "reason": "…", "cwd": ".", "timeout_seconds": 60}' : '{"command": "…", "reason": "…", "cwd": ".", "timeout_seconds": 60, "prefix_rule": ["npm", "test"]}',
    description: env.permissions === 'act'
      ? `Run a command on the user's computer, ${reach(env).where} (${env.computer.shell}). It runs at once, exactly as written — the user lets you act without asking — and its output comes back as the result; they can see it in your Activity. "cwd" is ${reach(env).paths}; a command is stopped after "timeout_seconds", at most ${MAX_TIMEOUT_SECONDS}.`
      : `Ask to run a command on the user's computer, ${reach(env).where} (${env.computer.shell}). The user approves each command in the conversation before it runs, exactly as written, and its output comes back to you as an event. "cwd" is ${reach(env).paths}; a command is stopped after "timeout_seconds", at most ${MAX_TIMEOUT_SECONDS}. For a command you will run again — tests, a build, a linter — offer "prefix_rule", its leading words, so the user can allow commands that start that way for good; those then run at once and return their output. Never offer one for an interpreter or anything destructive.`,
  },
  handler: { id: 'user_run_command', run: async (args, context) => requestApproval(env, args, context.turnId, false) },
});

const startJobTool = (env: DotComputerEnv): DotToolEntry => ({
  doc: {
    name: 'user_start_job',
    args: '{"command": "…", "reason": "…", "cwd": "."}',
    description: env.permissions === 'act'
      ? `Start a command that keeps running in the background on the user's computer, ${reach(env).where} (${env.computer.shell}); "cwd" is ${reach(env).paths}. It starts at once — the user lets you act without asking — runs with no time limit while you carry on, and you hear when it ends.`
      : `Ask to start a command that keeps running in the background on the user's computer, ${reach(env).where} (${env.computer.shell}); "cwd" is ${reach(env).paths}. The user approves it first, exactly as written; then it runs with no time limit while you carry on, and you hear when it ends.`,
  },
  handler: { id: 'user_start_job', run: async (args, context) => requestApproval(env, args, context.turnId, true) },
});

const findJob = (env: DotToolEnv, id: string | undefined): DotJob | undefined =>
  getDotThread(env.dotId)?.runtime.jobs?.find((job) => job.id === id);

const unknownJob = (env: DotToolEnv, id: string | undefined) => {
  const jobs = getDotThread(env.dotId)?.runtime.jobs ?? [];
  const known = jobs.slice(-6).map((job) => `${job.id} \`${job.command}\` (${job.status})`).join('; ');
  return fail(`No background job "${id ?? ''}". ${known ? `Your recent jobs: ${known}.` : 'You have not started any.'}`);
};

const checkJobTool = (env: DotComputerEnv): DotToolEntry => ({
  doc: {
    name: 'user_check_job',
    args: '{"id": "i123", "from_start": false}',
    description: 'Read what one of your background jobs on the user\'s computer has printed since you last checked — or from its start — and whether it is still running.',
  },
  handler: {
    id: 'user_check_job',
    async run(args) {
      const id = stringArg(args, 'id');
      const job = findJob(env, id);
      if (!job) return unknownJob(env, id);
      let state;
      try {
        state = await env.computer.bridge.readJob(job.jobId, args.from_start === true ? 0 : job.readTo);
      } catch (error) {
        return fail(computerProblem(error));
      }
      updateDotRuntime(env.dotId, (runtime) => ({
        ...runtime,
        jobs: (runtime.jobs ?? []).map((entry) => (entry.id === job.id ? { ...entry, readTo: state.next } : entry)),
      }));
      const status = state.running
        ? 'still running'
        : state.signal === 'STOPPED'
          ? 'stopped'
          : `ended with exit code ${state.code ?? 'unknown'}`;
      const body = state.text.trim() ? clip(state.text.replace(/\s+$/, '')) : '(nothing new)';
      return ok(`Job ${job.id} \`${job.command}\`: ${status}.${state.truncated ? ' Some earlier output was dropped.' : ''}\n${body}`);
    },
  },
});

const stopJobTool = (env: DotComputerEnv): DotToolEntry => ({
  doc: {
    name: 'user_stop_job',
    args: '{"id": "i123"}',
    description: 'Stop one of your background jobs on the user\'s computer, with everything it started. You hear when it has ended.',
  },
  handler: {
    id: 'user_stop_job',
    async run(args) {
      const id = stringArg(args, 'id');
      const job = findJob(env, id);
      if (!job) return unknownJob(env, id);
      if (job.status !== 'running') return ok(`Job ${job.id} is not running (${job.status}).`);
      try {
        await env.computer.bridge.stopJob(job.jobId);
      } catch (error) {
        return fail(computerProblem(error));
      }
      return ok(`Stopping job ${job.id}. You will hear when it has ended.`);
    },
  },
});

/** Programs that run whatever they read: typing into one would run commands nobody approved. */
const SHELLS = new Set(['bash', 'sh', 'zsh', 'fish', 'dash', 'ksh', 'cmd', 'powershell', 'pwsh', 'wsl']);
const REPLS = new Set(['python', 'python3', 'py', 'node', 'deno', 'bun', 'ruby', 'irb', 'perl', 'php', 'lua', 'psql', 'mysql', 'sqlite3', 'mongosh', 'mongo', 'redis-cli']);

/** Whether typing into a job could only answer the program, never run new commands: not a shell, not a bare REPL. */
export const typingIsSafe = (command: string): boolean => {
  const words = command.trim().split(/\s+/);
  const head = (words[0] ?? '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
  if (SHELLS.has(head)) return false;
  return !(REPLS.has(head) && words.length === 1);
};

const sendToJobTool = (env: DotComputerEnv): DotToolEntry => ({
  doc: {
    name: 'user_send_to_job',
    args: '{"id": "i123", "text": "…", "enter": true, "close": false}',
    description: 'Type into one of your background jobs on the user\'s computer — an answer to a prompt it is waiting on, a choice in an installer — as Codex\'s write_stdin does. "enter" ends the line; "close" ends its input. Read what it says first with user_check_job. A shell or a bare interpreter cannot be typed into: that would run commands the user never approved.',
  },
  handler: {
    id: 'user_send_to_job',
    async run(args) {
      const id = stringArg(args, 'id');
      const job = findJob(env, id);
      if (!job) return unknownJob(env, id);
      if (job.status !== 'running') return fail(`Job ${job.id} is not running (${job.status}).`);
      if (!typingIsSafe(job.command)) return fail(`\`${job.command}\` runs whatever it is given, so typing into it would run commands the user never approved. Ask to run each command instead.`);
      const text = typeof args.text === 'string' ? args.text : '';
      const line = args.enter === false ? text : `${text}\n`;
      try {
        await env.computer.bridge.writeJob(job.jobId, line, args.close === true);
      } catch (error) {
        return fail(computerProblem(error));
      }
      return ok(`Typed into job ${job.id}${args.close === true ? ' and ended its input' : ''}. Read what it does next with user_check_job.`);
    },
  },
});

const computerFilesTool = (env: DotComputerEnv): DotToolEntry => ({
  doc: {
    name: 'user_files',
    args: '{"action": "list" | "read" | "search", "path": ".", "query": "…", "depth": 1, "offset": 0}',
    description: `Look at files on the user's computer, ${reach(env).where}, without asking: list a folder ("depth" up to 4), read a text file (a long one continues from "offset"), or search file names and contents under "path" for "query". "path" is ${reach(env).paths}. It never changes anything. Files that hold keys, credentials or environment secrets are off limits here.`,
  },
  handler: {
    id: 'user_files',
    async run(args) {
      if (!stillConnected(env)) return fail(DISCONNECTED);
      const action = stringArg(args, 'action') ?? 'list';
      const place = locatePath(env.computer, stringArg(args, 'path'));
      if (place === null) return fail(env.computer.whole ? '"path" must be a full path, or one relative to the user\'s home folder.' : `"path" must be inside ${env.computer.root}, written relative to it.`);
      const { root, path } = place;
      const { bridge } = env.computer;
      const show = (relative: string) => shownPath(env.computer, root, relative);
      try {
        if (action === 'list') {
          const depth = Math.max(1, Math.min(4, Math.round(Number(args.depth ?? 1)) || 1));
          const listing = await bridge.listFiles(root, path, depth);
          if (listing.entries.length === 0) return ok(`${show(path)} is empty.`);
          const lines = listing.entries.map((entry) => entry.type === 'dir'
            ? `${show(entry.path)}/${entry.skipped ? ' (not opened: dependencies or build output)' : ''}`
            : `${show(entry.path)} — ${size(entry.size)}${isSecretPath(entry.path) ? ' (off limits)' : ''}`);
          return ok(clip(`${show(path)}:\n${lines.join('\n')}${listing.truncated ? '\n[More entries not shown: list a subfolder.]' : ''}`));
        }
        if (action === 'read') {
          if (path === '.') return fail('Give the "path" of a file to read.');
          if (isSecretPath(path)) return fail(`${show(path)} looks like it holds secrets, so it is off limits here. If the work truly needs it, ask the user.`);
          const offset = Math.max(0, Math.round(Number(args.offset ?? 0)) || 0);
          const file = await bridge.readFile(root, path, offset);
          if (file.binary) return ok(`${show(path)} is a binary file (${size(file.size)}); it cannot be shown as text.`);
          const more = file.next !== null ? `\n[Continues: read on with "offset": ${file.next}.]` : '';
          return ok(`${show(path)} — ${size(file.size)}${offset ? `, from byte ${offset}` : ''}:\n${clip(file.text)}${more}`);
        }
        if (action === 'search') {
          const query = stringArg(args, 'query');
          if (!query) return fail('Give a "query" to search for.');
          const result = await bridge.searchFiles(root, query, path);
          const matches = result.matches.filter((match) => !isSecretPath(match.path));
          if (matches.length === 0) return ok(`Nothing under ${show(path)} matches "${query}".`);
          const lines = matches.map((match) => (match.line > 0 ? `${show(match.path)}:${match.line}: ${match.text}` : `${show(match.path)} (file name)`));
          return ok(clip(`${lines.join('\n')}${result.truncated ? '\n[More matches not shown: narrow the search.]' : ''}`));
        }
        return fail('"action" must be list, read or search.');
      } catch (error) {
        return fail(computerProblem(error));
      }
    },
  },
});

const MAX_PATCH_CHARS = 400_000;

/** A patch's file path as a key relative to the connected folder, or a parse error that names it. */
export const patchPath = (raw: string, line: number): string => {
  const path = relativePath(raw);
  if (path === null || path === '.') throw new PatchParseError(`"${raw.trim()}" is not a file inside the connected folder. Write paths relative to it.`, line);
  return path;
};

/** The text as a patch sees it — no byte-order mark, LF endings — and the way back to the file's own form. */
export const patchable = (text: string): { text: string; restore: (next: string) => string } => {
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const crlf = text.includes('\r\n');
  const plain = (bom ? text.slice(1) : text).replace(/\r\n/g, '\n');
  return { text: plain, restore: (next) => bom + (crlf ? next.replace(/\r?\n/g, '\r\n') : next) };
};

const missing = (error: unknown): boolean => /ENOENT|no such file/i.test(error instanceof Error ? error.message : String(error));

/** A patch checked against the files as they are now: what it would write, and the changes that makes. */
export interface PreparedPatch {
  writes: { key: string; root: string; path: string; text: string; modifiedAt?: number }[];
  changes: FileChange[];
  /** The folder the changes are in, for their card. */
  folder: string;
}

/**
 * Reads what a patch touches and applies it in memory: everything it would write, or why it cannot apply. Nothing is
 * written, so a patch that fails anywhere changes nothing. Deleting and moving stay with commands.
 */
export const preparePatch = async (computer: DotComputerScope & { bridge: DotComputerBridge }, patch: string): Promise<PreparedPatch | { problem: string }> => {
  if (!patch.trim()) return { problem: 'Give the "patch".' };
  if (patch.length > MAX_PATCH_CHARS) return { problem: 'That patch is too large; split it into smaller ones.' };
  // A file's key: its path in the folder, or in full with the whole computer connected.
  const keyOf = (raw: string, line: number): string => {
    if (!computer.whole) return patchPath(raw, line);
    const at = locatePath(computer, raw);
    if (!at || at.path === '.') throw new PatchParseError(`"${raw.trim()}" is not a file's path. Write it in full, or relative to the user's home folder.`, line);
    return shownPath(computer, at.root, at.path);
  };
  const placeOf = (key: string): { root: string; path: string } => (computer.whole ? locatePath(computer, key)! : { root: computer.root, path: key });
  let ops: PatchOp[];
  try {
    ops = parsePatch(patch, keyOf);
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) };
  }
  if (ops.length === 0) return { problem: 'That patch changes nothing.' };
  for (const op of ops) {
    if (op.kind === 'delete' || op.movePath) return { problem: `${op.kind === 'delete' ? 'Deleting' : 'Moving'} ${op.path} takes a command the user approves: use user_run_command.` };
    if (isSecretPath(placeOf(op.path).path)) return { problem: `${op.path} looks like it holds secrets, so it is off limits here. If the work truly needs it, ask the user.` };
  }

  const files: Record<string, string> = {};
  const originals = new Map<string, { modifiedAt?: number; restore: (next: string) => string }>();
  for (const op of ops) {
    if (op.path in files || originals.has(op.path)) continue;
    let existing: DotFileContent | null;
    try {
      const at = placeOf(op.path);
      existing = await computer.bridge.readFile(at.root, at.path);
    } catch (error) {
      if (!missing(error)) return { problem: computerProblem(error) };
      existing = null;
    }
    if (op.kind === 'add') {
      if (existing) return { problem: `${op.path} already exists. Change it with "*** Update File: ${op.path}".` };
      continue;
    }
    if (!existing) return { problem: `${op.path} does not exist. Create it with "*** Add File: ${op.path}".` };
    if (existing.binary) return { problem: `${op.path} is a binary file, which a patch cannot change.` };
    if (existing.next !== null) return { problem: `${op.path} is too large to patch here (${size(existing.size)}). Change it with a command the user approves.` };
    const form = patchable(existing.text);
    files[op.path] = form.text;
    originals.set(op.path, { modifiedAt: existing.modifiedAt, restore: form.restore });
  }

  let result: ReturnType<typeof applyPatch>;
  try {
    result = applyPatch(files, ops);
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) };
  }
  const changes = result.changes.filter((change) => result.files[change.path] !== undefined);
  const writes = changes.map((change) => {
    const original = originals.get(change.path);
    const next = result.files[change.path]!;
    return { key: change.path, ...placeOf(change.path), text: original ? original.restore(next) : next, ...(original?.modifiedAt !== undefined ? { modifiedAt: original.modifiedAt } : {}) };
  });
  const folder = computer.whole && changes.length ? commonFolder(changes.map((change) => change.path)) : computer.root;
  return { writes, changes, folder };
};

/** Writes a prepared patch, file by file, each only if it has not changed since it was read. */
export const writePatch = async (bridge: DotComputerBridge, prepared: PreparedPatch): Promise<{ written: FileChange[]; problem?: string }> => {
  const written: FileChange[] = [];
  for (const write of prepared.writes) {
    try {
      await bridge.writeFile(write.root, write.path, write.text, write.modifiedAt);
      const change = prepared.changes.find((entry) => entry.path === write.key);
      if (change) written.push(change);
    } catch (error) {
      const done = written.length ? ` Already changed: ${written.map((entry) => entry.path).join(', ')}.` : ' Nothing was changed.';
      return { written, problem: `${write.key} could not be written: ${computerProblem(error)}${done}` };
    }
  }
  return { written };
};

/** What an edit card lists: the changed files, named inside the folder they share. */
export const editRecord = (computer: DotComputerScope, folder: string, changes: FileChange[]): DotEditRecord => ({
  root: folder,
  files: changes.map((change) => ({
    path: computer.whole ? change.path.slice(folder.length).replace(/^[\\/]+/, '').replace(/\\/g, '/') || change.path : change.path,
    kind: change.kind === 'add' ? 'add' : 'update',
    added: change.added,
    removed: change.removed,
  })),
});

/** The changes a patch made, as the bot reads them. */
export const describeChanges = (changes: FileChange[]): string =>
  changes.map((change) => `${change.kind === 'add' ? 'added' : 'updated'} ${change.path} (+${change.added} −${change.removed}${change.fuzz ? ', context matched loosely: check it' : ''})`).join('; ');

/**
 * Codex's `apply_patch`, against the connected folder (or the whole computer): edits apply at once, as in Codex's
 * workspace-write mode, and the conversation shows a card of what changed — or, when the user asked the bot to check
 * with them first, the card proposes them and nothing changes until they apply it. Each file is read first and
 * written only if it has not changed since; a patch that fails anywhere before writing changes nothing.
 */
const applyPatchTool = (env: DotComputerEnv): DotToolEntry => ({
  doc: {
    name: 'user_apply_patch',
    args: '{"patch": "*** Begin Patch\\n*** Update File: path\\n@@ …\\n-old\\n+new\\n*** End Patch"}',
    description: `Change files on the user's computer, ${reach(env).where}, with a patch in Codex's apply_patch format; ${env.permissions === 'ask' ? 'it reaches the user as a card, and the files change once they apply it — until then they stay as they are, so build on a change only once it is applied' : 'it applies at once and the user sees what changed'}. Between "*** Begin Patch" and "*** End Patch": "*** Add File: path" and then every line of the new file starting with "+"; or "*** Update File: path" and then hunks, each opening "@@" (optionally followed by a line that locates it, like a function's signature) with the lines around the change starting " ", removed lines "-" and added lines "+", about three unchanged lines either side. Paths are ${env.computer.whole ? 'full paths, or relative to the user\'s home folder' : 'relative to the folder'}. Read a file before changing it: one that changed since is left alone. Deleting or moving files takes a command${env.permissions === 'act' ? '' : ' the user approves'}.`,
  },
  handler: {
    id: 'user_apply_patch',
    async run(args, context) {
      if (!stillConnected(env)) return fail(DISCONNECTED);
      const patch = typeof args.patch === 'string' ? args.patch : typeof args.input === 'string' ? args.input : '';
      const prepared = await preparePatch(env.computer, patch);
      if ('problem' in prepared) return fail(prepared.problem);
      if (prepared.changes.length === 0) return ok('The patch left every file as it was.');
      if (permissionsNow(env) === 'ask') {
        const item = appendDotItem(env.dotId, {
          kind: 'edit',
          text: prepared.changes.map((change) => change.path).join(', '),
          turnId: context.turnId,
          edit: { ...editRecord(env.computer, prepared.folder, prepared.changes), proposed: { patch, scope: { root: env.computer.root, ...(env.computer.whole ? { whole: true } : {}) } } },
        });
        return ok(`Asked the user to apply this change to ${prepared.folder} (${item.id}): ${describeChanges(prepared.changes)}. Nothing has changed yet: their decision will reach you as an event. Carry on with anything that does not depend on it, or end your turn.`);
      }
      const { written, problem } = await writePatch(env.computer.bridge, prepared);
      if (written.length === 0) return problem ? fail(problem) : ok('The patch left every file as it was.');
      const item = appendDotItem(env.dotId, {
        kind: 'edit',
        text: written.map((change) => change.path).join(', '),
        turnId: context.turnId,
        edit: editRecord(env.computer, prepared.folder, written),
      });
      return problem ? fail(`${problem} (${item.id})`) : ok(`Changed ${prepared.folder} (${item.id}): ${describeChanges(written)}.`);
    },
  },
});

/** Everything a bot can use on the user's computer while a folder, or the whole computer, is connected. */
export const computerTools = (env: DotComputerEnv): DotToolEntry[] => [
  computerFilesTool(env),
  applyPatchTool(env),
  runCommandTool(env),
  startJobTool(env),
  checkJobTool(env),
  sendToJobTool(env),
  stopJobTool(env),
];
