/**
 * A bot's own computer, from the user's side: setting it up (or not), turning
 * it off, resetting it, and the wheel — taking over when the bot asks or
 * unasked, handing back, typing in a secret. The tools only ever ask
 * (tools/machine-tools.ts); everything here is the user answering.
 *
 * Every step the bot needs to know about is an event in its thread. How a
 * request for help ends is decided on the computer — the user hands back, a
 * request lapses, the computer turns off — so one window on the machine (the
 * holder of the `willow-dot-machines` lock) follows the wheel and records each
 * ending once.
 */
import { appendDotItem, dotThreads, getDotThread, updateDotRuntime, type DotItemDraft } from '../thread/thread-store';
import type { DotItem, DotMachineStep } from '../thread/thread-types';
import { helpOutcome, helpTaken, MACHINE_WORKSPACE, openHelpRequests, pendingSetupRequests, SECRET_TTL_MS } from '../tools/machine-tools';
import { machineProblem, type DotHelpRequest, type DotMachineBridge, type DotMachineControl, type DotMachineEvent } from './machine-bridge';
import { withWebLock } from './web-lock';

export interface DotMachineDeps {
  machine: DotMachineBridge;
  now: () => number;
  /** Wakes the bot to act on what was just recorded. */
  wake: (dotId: string) => void;
}

const postEvent = (dotId: string, step: DotMachineStep, text: string, draft: Omit<DotItemDraft, 'kind' | 'text'> = {}): DotItem | null =>
  getDotThread(dotId) ? appendDotItem(dotId, { kind: 'event', event: 'machine', machineStep: step, text, ...draft }) : null;

const READY = `Your computer is ready: your own account on a Linux machine on the user's PC, with a desktop, a browser, a shell and a folder (${MACHINE_WORKSPACE}). It turns on when you use it.`;

/**
 * The user agreed to the bot having a computer: from its request in the
 * conversation, or unasked from its profile. Resolves to a problem to show,
 * or null once the computer exists.
 */
export const setUpMachine = async (dotId: string, deps: DotMachineDeps): Promise<string | null> => {
  const thread = getDotThread(dotId);
  if (!thread) return 'This bot is not loaded yet. Try again in a moment.';
  const asked = pendingSetupRequests(thread);
  updateDotRuntime(dotId, (runtime) => ({ ...runtime, machine: { allowedAt: runtime.machine?.allowedAt ?? deps.now() } }));
  for (const item of asked) postEvent(dotId, 'allowed', `The user agreed to set up your computer (${item.id}). It is being made now; you will hear when it is ready.`, { ref: item.id });
  try {
    await deps.machine.create(dotId);
  } catch (error) {
    const problem = machineProblem(error);
    for (const item of asked) postEvent(dotId, 'failed', `Setting up your computer (${item.id}) failed: ${problem}`, { ref: item.id, failed: true });
    if (asked.length) deps.wake(dotId);
    return problem;
  }
  if (asked.length) {
    for (const item of asked) postEvent(dotId, 'ready', READY, { ref: item.id });
    deps.wake(dotId);
  } else {
    // Unasked: the bot learns it has a computer when it next acts, with nothing to act on now.
    postEvent(dotId, 'allowed', `The user set up a computer of your own. ${READY}`);
  }
  return null;
};

export const declineMachineSetup = (dotId: string, itemId: string, deps: DotMachineDeps): void => {
  const thread = getDotThread(dotId);
  if (!thread || !pendingSetupRequests(thread).some((item) => item.id === itemId)) return;
  postEvent(dotId, 'declined', `The user declined to set up your computer for now (${itemId}). Do not ask again unless they bring it up; do the work another way, or tell them what it would take.`, { ref: itemId });
  deps.wake(dotId);
};

export const turnOffMachine = async (dotId: string, deps: DotMachineDeps): Promise<string | null> => {
  try {
    await deps.machine.stop(dotId);
  } catch (error) {
    return machineProblem(error);
  }
  postEvent(dotId, 'off', 'The user turned off your computer. Anything you left running on it has stopped; it turns on again when you next use it.');
  return null;
};

export const turnOnMachine = async (dotId: string, deps: DotMachineDeps): Promise<string | null> => {
  try {
    await deps.machine.start(dotId);
    return null;
  } catch (error) {
    return machineProblem(error);
  }
};

export const resetMachine = async (dotId: string, deps: DotMachineDeps): Promise<string | null> => {
  try {
    await deps.machine.reset(dotId);
  } catch (error) {
    return machineProblem(error);
  }
  postEvent(dotId, 'reset', 'The user reset your computer: everything on it — files, sign-ins, installed software — is gone, and it starts fresh.');
  return null;
};

/** The bot is gone: so is its computer. */
export const removeMachine = async (dotId: string, deps: DotMachineDeps): Promise<void> => {
  await deps.machine.remove(dotId).catch(() => undefined);
};

/* ------------------------------------------------------------------------ */
/* The wheel                                                                 */
/* ------------------------------------------------------------------------ */

const control = async (dotId: string, deps: DotMachineDeps, path: string, body: Record<string, unknown> = {}): Promise<{ control: DotMachineControl | null; problem: string | null }> => {
  try {
    const reply = await deps.machine.call<DotMachineControl>(dotId, { method: 'POST', path, body, timeoutMs: 30_000 });
    if (reply.status >= 200 && reply.status < 300) return { control: reply.body, problem: null };
    return { control: null, problem: reply.body?.error ?? 'Your dot\'s computer could not do that.' };
  } catch (error) {
    return { control: null, problem: machineProblem(error) };
  }
};

/** The user takes the wheel: the request in `requestId`, or — unasked — whatever the bot is doing. */
export const takeOverMachine = (dotId: string, requestId: string | undefined, deps: DotMachineDeps) =>
  control(dotId, deps, '/control/take', requestId ? { requestId } : {});

export const handBackMachine = async (dotId: string, requestId: string, deps: DotMachineDeps) =>
  control(dotId, deps, '/control/release', { requestId });

/** The user dismisses a request: a takeover nobody will take, or a secret they will not give. */
export const dismissHelp = async (dotId: string, itemId: string, deps: DotMachineDeps): Promise<string | null> => {
  const item = getDotThread(dotId)?.items.find((entry) => entry.id === itemId && entry.kind === 'help');
  if (!item?.help) return null;
  if (item.help.kind === 'secret') {
    await control(dotId, deps, '/control/secret/cancel');
    await settleOnce(dotId, itemId, () => {
      postEvent(dotId, 'cancelled', `The user did not enter ${item.help!.label ?? 'the secret'} (${itemId}). Do not ask for it another way.`, { ref: itemId });
      deps.wake(dotId);
    });
    return null;
  }
  const { problem } = await control(dotId, deps, '/control/cancel', { requestId: item.help.requestId });
  // The watcher records the ending from the computer's own answer.
  return problem;
};

/** The secret the bot asked for, typed by the user straight into the field — never into the thread. */
export const enterSecret = async (dotId: string, itemId: string, value: string, deps: DotMachineDeps): Promise<string | null> => {
  const item = getDotThread(dotId)?.items.find((entry) => entry.id === itemId && entry.kind === 'help');
  if (!item?.help || item.help.kind !== 'secret' || !value) return null;
  let problem: string | null = null;
  try {
    const reply = await deps.machine.call(dotId, { method: 'POST', path: '/human/secret', body: { text: value }, timeoutMs: 30_000 });
    if (reply.status < 200 || reply.status >= 300) problem = reply.body?.error ?? 'That could not be entered.';
  } catch (error) {
    problem = machineProblem(error);
  }
  const label = item.help.label ?? 'the secret';
  if (problem && !/no longer on the page|Nothing is waiting/i.test(problem)) return problem;
  await settleOnce(dotId, itemId, () => {
    if (problem) postEvent(dotId, 'interrupted', `${label} (${itemId}) could not be entered: the field it was for is gone. Look at the page again, and ask again if it still needs it.`, { ref: itemId, failed: true });
    else postEvent(dotId, 'entered', `The user entered ${label} into the field (${itemId}). It went straight into the page; you were not told what it is.`, { ref: itemId });
    deps.wake(dotId);
  });
  return problem;
};

/** Records one ending of one request, whichever window gets there first. */
const settleOnce = (dotId: string, itemId: string, record: () => void): Promise<boolean> =>
  withWebLock(`willow-dot-help:${itemId}`, async () => {
    const thread = getDotThread(dotId);
    if (!thread || helpOutcome(thread, itemId)) return;
    record();
  });

const ENDINGS: Record<Exclude<DotHelpRequest['status'], 'waiting' | 'taken'>, DotMachineStep> = {
  completed: 'returned',
  cancelled: 'cancelled',
  expired: 'expired',
  interrupted: 'interrupted',
};

const endingText = (step: DotMachineStep, itemId: string, request?: DotHelpRequest): string => {
  switch (step) {
    case 'returned':
      return `The user handed your computer back (${itemId}). Look again — a snapshot of the page, or a screenshot — before you act: things may have changed while they had it.`;
    case 'cancelled':
      return `The user dismissed your request for help (${itemId}); nothing was done on the page. Your computer is yours again.`;
    case 'expired':
      return `Nobody took your request for help (${itemId}) within 10 minutes, so it lapsed and your computer is yours again. If you still need the user, tell them what for.`;
    default:
      return `Your request for help (${itemId}) ended before the user handed your computer back: ${request?.interruption ?? 'your computer stopped'}.`;
  }
};

/** What the bot hears about one request for help, from the computer's current word on it. */
const settleRequest = async (dotId: string, item: DotItem, request: DotHelpRequest | undefined, deps: DotMachineDeps): Promise<void> => {
  const help = item.help!;
  if (help.kind === 'secret') return;
  if (request?.status === 'waiting') return;
  if (request?.status === 'taken') {
    await withWebLock(`willow-dot-help:${item.id}`, async () => {
      const thread = getDotThread(dotId);
      if (!thread || helpTaken(thread, item.id) || helpOutcome(thread, item.id)) return;
      postEvent(dotId, 'taken', `The user took over your computer (${item.id}).`, { ref: item.id });
    });
    return;
  }
  const step = request ? ENDINGS[request.status] : 'interrupted';
  await settleOnce(dotId, item.id, () => {
    postEvent(dotId, step, endingText(step, item.id, request), { ref: item.id });
    clearBlocked(dotId);
    deps.wake(dotId);
  });
};

const clearBlocked = (dotId: string) => {
  updateDotRuntime(dotId, (runtime) => (runtime.machine?.blockedAt ? { ...runtime, machine: { allowedAt: runtime.machine.allowedAt } } : runtime));
};

/**
 * The user took the wheel unasked and gave it back. The bot is told, and woken
 * only if something it tried meanwhile was refused.
 */
const settleUnasked = (dotId: string, request: DotHelpRequest, deps: DotMachineDeps) =>
  withWebLock(`willow-dot-help:${request.id}`, async () => {
    const thread = getDotThread(dotId);
    if (!thread || thread.items.some((item) => item.kind === 'event' && item.event === 'machine' && item.ref === request.id)) return;
    const blocked = Boolean(thread.runtime.machine?.blockedAt);
    if (blocked) {
      postEvent(dotId, 'returned', 'The user took over your computer and has handed it back. Look again — a snapshot of the page, or a screenshot — before you act: things may have changed while they had it.', { ref: request.id });
      clearBlocked(dotId);
      deps.wake(dotId);
    } else {
      postEvent(dotId, 'taken', 'The user took over your computer for a while and has handed it back. Look again before you next act there: things may have changed.', { ref: request.id });
    }
  });

/** Brings the record in line with what the computer says now about every open request. */
const reconcile = async (dotId: string, current: DotMachineControl | null, deps: DotMachineDeps): Promise<void> => {
  const thread = getDotThread(dotId);
  if (!thread) return;
  for (const item of openHelpRequests(thread)) {
    const help = item.help!;
    if (help.kind === 'secret') {
      const wanted = current?.secretRequestedAt && `secret:${current.secretRequestedAt}` === help.requestId;
      if (!wanted && Date.now() - item.at > 30_000) {
        await settleOnce(dotId, item.id, () => {
          postEvent(dotId, 'expired', `Your request for ${help.label ?? 'a secret'} (${item.id}) is no longer open on your computer, so nothing was entered.`, { ref: item.id });
          deps.wake(dotId);
        });
      } else if (wanted && Date.now() - item.at > SECRET_TTL_MS) {
        await settleOnce(dotId, item.id, () => {
          postEvent(dotId, 'expired', `Nobody entered ${help.label ?? 'the secret'} (${item.id}) within 10 minutes, so the request lapsed.`, { ref: item.id });
          deps.wake(dotId);
        });
      }
      continue;
    }
    if (current?.request?.id === help.requestId) {
      await settleRequest(dotId, item, current.request, deps);
      continue;
    }
    // Not the computer's current request: ask after it by id; gone means the computer restarted.
    let request: DotHelpRequest | undefined;
    try {
      const reply = await deps.machine.call<DotMachineControl>(dotId, { method: 'GET', path: `/control?requestId=${encodeURIComponent(help.requestId)}`, timeoutMs: 15_000 });
      request = reply.status === 200 ? reply.body.request : undefined;
    } catch {
      continue;
    }
    await settleRequest(dotId, item, request, deps);
  }
  if (current?.request?.source === 'person' && current.request.status === 'completed') await settleUnasked(dotId, current.request, deps);
};

/** A computer that stopped took every open request with it. */
const settleStopped = async (dotId: string, deps: DotMachineDeps): Promise<void> => {
  const thread = getDotThread(dotId);
  if (!thread) return;
  for (const item of openHelpRequests(thread)) {
    await settleOnce(dotId, item.id, () => {
      postEvent(dotId, 'interrupted', item.help?.kind === 'secret'
        ? `Your computer turned off, so your request for ${item.help.label ?? 'a secret'} (${item.id}) ended with nothing entered.`
        : `Your computer turned off, so your request for help (${item.id}) ended.`, { ref: item.id });
      deps.wake(dotId);
    });
  }
};

/**
 * Follows every bot's computer while Willow is open: one window on the machine
 * at a time — whichever holds the lock — and another takes over when it
 * closes. Returns a stop function.
 */
export const watchDotMachines = (deps: () => DotMachineDeps): (() => void) => {
  let stopped = false;
  let release: (() => void) | undefined;
  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const queues = new Map<string, Promise<void>>();
  const serially = (dotId: string, work: () => Promise<void>) => {
    const next = (queues.get(dotId) ?? Promise.resolve()).then(work).catch((error) => console.warn('[bots] could not follow a dot\'s computer', error));
    queues.set(dotId, next);
  };
  const begin = () => {
    unsubscribe = deps().machine.subscribe((event: DotMachineEvent) => {
      if (event.type === 'control') serially(event.dotId, () => reconcile(event.dotId, event.control, deps()));
      else if (event.type === 'state' && (event.summary.state === 'stopped' || event.summary.state === 'none')) serially(event.dotId, () => settleStopped(event.dotId, deps()));
    });
    // What happened while no window was watching, and secrets left unanswered.
    const sweep = () => {
      for (const [dotId, thread] of Object.entries(dotThreads.get())) {
        if (!openHelpRequests(thread).length) continue;
        serially(dotId, async () => {
          const status = await deps().machine.status(dotId).catch(() => null);
          const summary = status?.machine;
          if (!summary) return;
          if (summary.state === 'running') await reconcile(dotId, summary.control, deps());
          else if (summary.state === 'stopped' || summary.state === 'none') await settleStopped(dotId, deps());
        });
      }
    };
    sweep();
    timer = setInterval(sweep, 30_000);
  };
  const locks = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks) {
    void locks.request('willow-dot-machines', () => new Promise<void>((resolve) => {
      release = resolve;
      if (stopped) resolve();
      else begin();
    }));
  } else {
    begin();
  }
  return () => {
    stopped = true;
    unsubscribe?.();
    clearInterval(timer);
    release?.();
  };
};
