/**
 * A bot's access to the user's own computer, from the user's side: connecting
 * a folder, and running — or not — each command the bot asked for. Asking is
 * the `user_run_command` / `user_start_job` tools (tools/computer-tools.ts),
 * which record the request; nothing here runs until the user approves it.
 * (When the user lets the bot act without asking, those tools run the
 * command themselves and write the same steps, as a record.)
 *
 * Every step is an event in the bot's thread. `approved` is written before a
 * command starts and `finished` after, so a window that closes mid-command
 * leaves a record that says so instead of an offer to run it twice. A
 * background job writes `started` when it launches and `finished` when it
 * ends; one watcher per machine notices the end and wakes the bot.
 */
import { appendDotItem, dotThreads, getDotThread, updateDotRuntime, type DotItemDraft } from '../thread/thread-store';
import type { DotItem, DotJob, DotThread } from '../thread/thread-types';
import { approvalDecision, approvalOutcome, pendingApprovals, unfinishedApprovals } from '../tools/computer-tools';
import { computerProblem, type DotCommandOutput, type DotComputerBridge, type DotJobOutput } from './computer-bridge';
import type { DotMachineBridge } from './machine-bridge';
import { withdrawPendingEdits } from './edits';
import { endScreenAccess } from './screen-control';
import { withWebLock } from './web-lock';

export interface DotComputerDeps {
  computer: DotComputerBridge;
  now: () => number;
  /** Wakes the bot to act on what was just recorded. */
  wake: (dotId: string) => void;
  /** The bot's own computer, which a proposed copy comes from. */
  machine?: DotMachineBridge;
}

const postEvent = (dotId: string, draft: Omit<DotItemDraft, 'kind'>): DotItem | null =>
  getDotThread(dotId) ? appendDotItem(dotId, { kind: 'event', ...draft }) : null;

/**
 * Whether the user has written to the bot yet. One nobody has written to is only told about its computer, quietly: woken
 * into an empty conversation, it would answer with a greeting, and a new bot says nothing of its own accord.
 */
const spokenTo = (dotId: string): boolean => Boolean(getDotThread(dotId)?.items.some((item) => item.kind === 'user'));

import { clipOutput, describeOutput } from './command-output';

export { clipOutput, describeOutput };

const duration = (ms: number): string => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1_000))} seconds`;
  if (minutes < 120) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `${Math.round(minutes / 60)} hours`;
};

const approvalItem = (thread: DotThread, approvalId: string): DotItem | undefined =>
  thread.items.find((item) => item.id === approvalId && item.kind === 'approval' && item.approval);

/** What waits for the user on their computer, as the bot's Permissions have it. */
const terms = (dotId: string): string => {
  const mode = getDotThread(dotId)?.runtime.permissions;
  if (mode === 'act') return 'changes and commands happen at once, as the user lets you act without asking';
  if (mode === 'ask') return 'each change to a file and each command waits for their approval';
  return 'each command waits for their approval';
};

const updateJob = (dotId: string, id: string, patch: Partial<DotJob>): void => {
  updateDotRuntime(dotId, (runtime) => ({
    ...runtime,
    jobs: (runtime.jobs ?? []).map((job) => (job.id === id ? { ...job, ...patch } : job)),
  }));
};

const withdrawPendingApprovals = (dotId: string, why: string): void => {
  const thread = getDotThread(dotId);
  if (!thread) return;
  for (const item of pendingApprovals(thread)) {
    postEvent(dotId, { event: 'approval', ref: item.id, approvalStep: 'withdrawn', text: `Your request to run \`${item.approval!.command}\` (${item.id}) was withdrawn: ${why}.` });
  }
  withdrawPendingEdits(dotId, why);
  // The screen comes with the computer, and goes with it.
  if (thread.runtime.computer) endScreenAccess(dotId, why);
};

/** Stops every job the bot has running. The watcher reports each as it ends. */
export const stopDotJobs = async (dotId: string, deps: DotComputerDeps): Promise<void> => {
  const running = (getDotThread(dotId)?.runtime.jobs ?? []).filter((job) => job.status === 'running');
  await Promise.all(running.map((job) => deps.computer.stopJob(job.jobId).catch(() => undefined)));
};

/**
 * Lets the bot ask to run commands inside `folder`. The folder is checked
 * through the companion first. The thread must be loaded. Resolves to a
 * problem to show the user, or null once connected.
 */
export const connectComputer = async (dotId: string, folder: string, deps: DotComputerDeps): Promise<string | null> => {
  const requested = folder.trim();
  if (!requested) return 'Choose a folder first.';
  if (!getDotThread(dotId)) return 'This bot is not loaded yet. Try again in a moment.';
  let root: string;
  try {
    root = await deps.computer.authorize(requested);
  } catch (error) {
    return computerProblem(error);
  }
  const previous = getDotThread(dotId)?.runtime.computer;
  if (previous?.root === root && !previous.whole) return null;
  if (previous) {
    withdrawPendingApprovals(dotId, `the user connected ${previous.whole ? 'one folder instead of their whole computer' : 'a different folder'}, ${root}`);
    await stopDotJobs(dotId, deps);
  }
  updateDotRuntime(dotId, { computer: { root, connectedAt: deps.now() } });
  const spoken = spokenTo(dotId);
  postEvent(dotId, { event: 'notice', text: `The user connected their computer. You can now look at the files in ${root}, change them and run commands there; ${terms(dotId)}.`, ...(spoken ? {} : { quiet: true }) });
  // The bot may have been waiting for exactly this.
  if (spoken) deps.wake(dotId);
  return null;
};

/**
 * Lets the bot work on the whole computer (the desktop app): any file the user's account can reach, from their
 * `home`, on any drive — still asking before each command. `root` is the drive `home` is on. Resolves to a problem
 * to show the user, or null once connected.
 */
export const connectWholeComputer = async (dotId: string, place: { root: string; home: string }, deps: DotComputerDeps): Promise<string | null> => {
  if (!getDotThread(dotId)) return 'This bot is not loaded yet. Try again in a moment.';
  let root: string;
  try {
    root = await deps.computer.authorize(place.root);
  } catch (error) {
    return computerProblem(error);
  }
  const previous = getDotThread(dotId)?.runtime.computer;
  if (previous?.whole) return null;
  if (previous) {
    withdrawPendingApprovals(dotId, 'the user connected their whole computer instead of one folder');
    await stopDotJobs(dotId, deps);
  }
  updateDotRuntime(dotId, { computer: { root, connectedAt: deps.now(), whole: true, home: place.home } });
  const spoken = spokenTo(dotId);
  postEvent(dotId, {
    event: 'notice',
    text: `The user connected their whole computer. You can now look at and change files anywhere their account can reach, starting from their home folder (${place.home}), and run commands anywhere on it; ${terms(dotId)}.`,
    ...(spoken ? {} : { quiet: true }),
  });
  if (spoken) deps.wake(dotId);
  return null;
};

export const disconnectComputer = async (dotId: string, deps: DotComputerDeps): Promise<void> => {
  if (!getDotThread(dotId)?.runtime.computer) return;
  withdrawPendingApprovals(dotId, 'the user disconnected their computer');
  const running = (getDotThread(dotId)?.runtime.jobs ?? []).some((job) => job.status === 'running');
  await stopDotJobs(dotId, deps);
  updateDotRuntime(dotId, { computer: undefined });
  postEvent(dotId, { event: 'notice', text: `The user disconnected their computer. You can no longer see its files or run commands on it.${running ? ' Your background jobs on it are being stopped.' : ''}`, ...(spokenTo(dotId) ? {} : { quiet: true }) });
};

/**
 * The user approved a command. Exactly that command runs, in the folder it
 * named, and the bot hears how it went — at once for a command, as it starts
 * and again when it ends for a background job. A lock keeps two windows from
 * running it at once.
 */
/** Commands starting with `prefix` run in that folder from now on without asking (Codex's prefix rules). */
export const allowCommandPrefix = (dotId: string, root: string, prefix: string[]): void => {
  updateDotRuntime(dotId, (runtime) => {
    const computer = runtime.computer;
    if (!computer || (!computer.whole && computer.root !== root) || (computer.rules ?? []).some((rule) => rule.join('\u0000') === prefix.join('\u0000'))) return runtime;
    return { ...runtime, computer: { ...computer, rules: [...(computer.rules ?? []), prefix] } };
  });
};

export const forgetCommandPrefix = (dotId: string, prefix: string[]): void => {
  updateDotRuntime(dotId, (runtime) => runtime.computer
    ? { ...runtime, computer: { ...runtime.computer, rules: (runtime.computer.rules ?? []).filter((rule) => rule.join('\u0000') !== prefix.join('\u0000')) } }
    : runtime);
};

export const approveCommand = async (dotId: string, approvalId: string, deps: DotComputerDeps, always = false): Promise<void> => {
  const thread = getDotThread(dotId);
  const item = thread && approvalItem(thread, approvalId);
  if (!thread || !item || approvalDecision(thread, approvalId)) return;
  const request = item.approval!;
  const connected = thread.runtime.computer;
  // With the whole computer connected, a command may run on any drive; with a folder, only in that folder.
  if (!connected || (!connected.whole && connected.root !== request.root)) {
    postEvent(dotId, { event: 'approval', ref: approvalId, approvalStep: 'withdrawn', text: `Your request to run \`${request.command}\` (${approvalId}) can no longer run: the user's computer is not connected to ${request.root} any more.` });
    deps.wake(dotId);
    return;
  }
  const allowed = always && request.prefix?.length ? request.prefix : undefined;
  if (allowed) allowCommandPrefix(dotId, request.root, allowed);
  const also = allowed ? ` They also allowed commands starting \`${allowed.join(' ')}\` here from now on; those run at once without asking.` : '';
  const separator = /^[A-Za-z]:/.test(request.root) ? '\\' : '/';
  const where = request.cwd === '.' ? request.root : `${request.root.replace(/[\\/]+$/, '')}${separator}${request.cwd.split('/').join(separator)}`;
  await withWebLock(`willow-dot-command:${approvalId}`, async () => {
    const latest = getDotThread(dotId);
    if (!latest || approvalDecision(latest, approvalId)) return;

    if (request.background) {
      try {
        const job = await deps.computer.startJob({ root: request.root, cwd: request.cwd, command: request.command });
        updateDotRuntime(dotId, (runtime) => ({
          ...runtime,
          jobs: [...(runtime.jobs ?? []), { id: approvalId, jobId: job.jobId, command: request.command, root: request.root, cwd: request.cwd, startedAt: job.startedAt || deps.now(), status: 'running' as const }].slice(-30),
        }));
        postEvent(dotId, { event: 'approval', ref: approvalId, approvalStep: 'started', text: `The user approved \`${request.command}\` (${approvalId}). It is running in the background in ${where}. You will hear when it ends; read its output with user_check_job and stop it with user_stop_job.` });
      } catch (error) {
        postEvent(dotId, { event: 'approval', ref: approvalId, approvalStep: 'approved', text: `The user approved \`${request.command}\` (${approvalId}).` });
        postEvent(dotId, { event: 'approval', ref: approvalId, approvalStep: 'finished', failed: true, text: `\`${request.command}\` (${approvalId}) could not start: ${computerProblem(error)}` });
      }
      deps.wake(dotId);
      return;
    }

    postEvent(dotId, { event: 'approval', ref: approvalId, approvalStep: 'approved', text: `The user approved \`${request.command}\` (${approvalId}). It is running in ${where}; its output will follow.${also}` });
    let text: string;
    let failed: boolean;
    try {
      const output = await deps.computer.execute({ root: request.root, cwd: request.cwd, command: request.command, timeoutMs: request.timeoutSeconds * 1_000 });
      failed = output.code !== 0;
      text = `\`${request.command}\` (${approvalId}) ${describeOutput(output, request.timeoutSeconds)}`;
    } catch (error) {
      failed = true;
      text = `\`${request.command}\` (${approvalId}) could not run: ${computerProblem(error)}`;
    }
    if (!getDotThread(dotId)) return;
    postEvent(dotId, { event: 'approval', ref: approvalId, approvalStep: 'finished', failed, text });
    deps.wake(dotId);
  });
};

export const declineCommand = (dotId: string, approvalId: string, deps: DotComputerDeps): void => {
  const thread = getDotThread(dotId);
  const item = thread && approvalItem(thread, approvalId);
  if (!thread || !item || approvalDecision(thread, approvalId)) return;
  postEvent(dotId, { event: 'approval', ref: approvalId, approvalStep: 'declined', text: `The user declined to run \`${item.approval!.command}\` (${approvalId}).` });
  deps.wake(dotId);
};

/** The user stopped a background job from the conversation. */
export const stopJob = async (dotId: string, approvalId: string, deps: DotComputerDeps): Promise<void> => {
  const job = getDotThread(dotId)?.runtime.jobs?.find((entry) => entry.id === approvalId && entry.status === 'running');
  if (job) await deps.computer.stopJob(job.jobId).catch(() => undefined);
};

/** Approved commands whose window closed before they finished: say so, unless another window is still running them. */
export const settleInterruptedCommands = (dotId: string, deps: DotComputerDeps): void => {
  const thread = getDotThread(dotId);
  if (!thread) return;
  for (const item of unfinishedApprovals(thread)) {
    void withWebLock(`willow-dot-command:${item.id}`, async () => {
      const latest = getDotThread(dotId);
      if (!latest || approvalOutcome(latest, item.id)) return;
      postEvent(dotId, {
        event: 'approval',
        ref: item.id,
        approvalStep: 'finished',
        failed: true,
        text: `\`${item.approval!.command}\` (${item.id}) was approved, but Willow closed before it finished, so its output was lost. It may have taken effect in part or in full; check before running it again.`,
      });
      deps.wake(dotId);
    });
  }
};

/* ------------------------------------------------------------------------ */
/* Watching background jobs                                                  */
/* ------------------------------------------------------------------------ */

const JOB_POLL_MS = 3_000;

const recordJobEnd = (dotId: string, job: DotJob, text: string, patch: Partial<DotJob>, failed: boolean, deps: DotComputerDeps): void => {
  const thread = getDotThread(dotId);
  if (!thread || approvalOutcome(thread, job.id)) return;
  updateJob(dotId, job.id, { ...patch, endedAt: patch.endedAt ?? deps.now() });
  postEvent(dotId, { event: 'approval', ref: job.id, approvalStep: 'finished', failed, text });
  deps.wake(dotId);
};

const describeJobEnd = (job: DotJob, state: DotJobOutput, now: number): { text: string; status: DotJob['status']; failed: boolean } => {
  const ran = duration((state.endedAt ?? now) - job.startedAt);
  const status: DotJob['status'] = state.signal === 'STOPPED' ? 'stopped' : state.code === 0 ? 'finished' : 'failed';
  const outcome = status === 'stopped'
    ? `was stopped after ${ran}.`
    : state.code === null
      ? `ended after ${ran}${state.signal ? ` (${state.signal})` : ''}.`
      : `exited with code ${state.code} after ${ran}.`;
  const tail = state.text.trim() ? `\nLast output:\n${clipOutput(state.text, 6_000)}` : '\nIt printed nothing more.';
  return { text: `Background job \`${job.command}\` (${job.id}) ${outcome}${tail}`, status, failed: status === 'failed' };
};

/** One pass over every running job of every loaded bot. */
export const checkDotJobs = async (deps: DotComputerDeps): Promise<void> => {
  for (const [dotId, thread] of Object.entries(dotThreads.get())) {
    for (const job of thread.runtime.jobs ?? []) {
      if (job.status !== 'running') continue;
      let state: DotJobOutput;
      try {
        // The tail since the bot last looked, so the report holds what it has not seen.
        state = await deps.computer.readJob(job.jobId, job.readTo);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/no such job/i.test(message)) {
          recordJobEnd(dotId, job, `Background job \`${job.command}\` (${job.id}) can no longer be followed: Willow's companion restarted, so whether and how it finished is unknown. Check its effects before running it again.`, { status: 'lost' }, true, deps);
        }
        // Otherwise the companion is unreachable for now; look again next pass.
        continue;
      }
      if (state.running) continue;
      await withWebLock(`willow-dot-command:${job.id}`, async () => {
        const end = describeJobEnd(job, state, deps.now());
        recordJobEnd(dotId, job, end.text, { status: end.status, code: state.code, endedAt: state.endedAt ?? deps.now() }, end.failed, deps);
      });
    }
  }
};

/**
 * Watches background jobs while Willow is open. Only one window on the machine
 * watches at a time — whichever holds the lock — and another takes over when
 * it closes. Returns a stop function.
 */
export const watchDotJobs = (deps: () => DotComputerDeps): (() => void) => {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let release: (() => void) | undefined;
  const loop = async () => {
    if (stopped) return;
    const busy = Object.values(dotThreads.get()).some((thread) => thread.runtime.jobs?.some((job) => job.status === 'running'));
    if (busy) await checkDotJobs(deps()).catch((error) => console.warn('[bots] could not check background jobs', error));
    if (!stopped) timer = setTimeout(() => void loop(), JOB_POLL_MS);
  };
  const locks = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks) {
    void locks.request('willow-dot-jobs', () => new Promise<void>((resolve) => {
      release = resolve;
      if (stopped) resolve();
      else void loop();
    }));
  } else {
    void loop();
  }
  return () => {
    stopped = true;
    clearTimeout(timer);
    release?.();
  };
};
