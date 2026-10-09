/**
 * A bot's triggers, kept in its thread's runtime state so they survive reloads, and every change to them.
 *
 * Event triggers start unprimed: their first look records what is already there — mail already in the inbox, the
 * page as it is now — so only what happens after the trigger was made can fire it. Resuming a paused trigger primes
 * it again, so a pause is never followed by a flood of everything that happened during it.
 */
import { getDotThread, updateDotRuntime } from '../thread/thread-store';
import type { DotRoutine, DotRuntimeState, DotTrigger, DotTriggerNotify, DotTriggerWhen } from '../thread/thread-types';
import { isTimeTrigger, KEEP_ENDED, MAX_TRIGGERS, nextFireAt } from './trigger-spec';

/** How many keys an event trigger remembers having seen. */
const SEEN_CAP = 400;

export const triggersOf = (runtime: Pick<DotRuntimeState, 'triggers'> | undefined): DotTrigger[] => runtime?.triggers ?? [];

export const findTrigger = (dotId: string, id: string): DotTrigger | undefined => triggersOf(getDotThread(dotId)?.runtime).find((trigger) => trigger.id === id);

/** Keeps the newest `SEEN_CAP` keys, in the order first seen. */
export const rememberSeen = (seen: readonly string[] | undefined, keys: readonly string[]): string[] => {
  const merged = [...(seen ?? [])];
  const known = new Set(merged);
  for (const key of keys) {
    if (known.has(key)) continue;
    known.add(key);
    merged.push(key);
  }
  return merged.slice(-SEEN_CAP);
};

/** Ended triggers beyond the newest few are dropped; the rest stay as a record. */
const pruned = (triggers: DotTrigger[]): DotTrigger[] => {
  const ended = triggers.filter((trigger) => trigger.status === 'ended').sort((a, b) => b.updatedAt - a.updatedAt).slice(KEEP_ENDED);
  if (ended.length === 0) return triggers;
  const drop = new Set(ended.map((trigger) => trigger.id));
  return triggers.filter((trigger) => !drop.has(trigger.id));
};

const writeTriggers = (dotId: string, change: (triggers: DotTrigger[]) => DotTrigger[]): DotTrigger[] => {
  const runtime = updateDotRuntime(dotId, (current) => ({ ...current, triggers: pruned(change(triggersOf(current))) }));
  return triggersOf(runtime);
};

export interface TriggerDraft {
  name: string;
  when: DotTriggerWhen;
  instruction: string;
  notify: DotTriggerNotify;
  timeZone: string;
  condition?: string;
  heartbeat?: boolean;
  until?: number;
  maxRuns?: number;
  /** Event triggers whose current state is known at creation (Spark tasks): the keys already there. */
  seen?: string[];
}

export type TriggerChange = { trigger: DotTrigger } | { error: string };

/** Makes a trigger. Time triggers know their first run; event triggers look soon, to prime. */
export const createTrigger = (dotId: string, draft: TriggerDraft, now: number): TriggerChange => {
  const thread = getDotThread(dotId);
  if (!thread) return { error: 'Your triggers are not loaded.' };
  const existing = triggersOf(thread.runtime);
  if (existing.filter((trigger) => trigger.status !== 'ended').length >= MAX_TRIGGERS) {
    return { error: `You already have ${MAX_TRIGGERS} triggers. Change or delete one first.` };
  }
  const highest = existing.reduce((max, trigger) => Math.max(max, Number(trigger.id.slice(1)) || 0), 0);
  const nextAt = isTimeTrigger(draft.when) ? nextFireAt(draft, now) : now;
  if (nextAt === undefined) return { error: 'That trigger would never fire.' };
  if (draft.until !== undefined && isTimeTrigger(draft.when) && nextAt > draft.until) return { error: 'That trigger would end before it ever fires. Check "until" and the schedule.' };
  const trigger: DotTrigger = {
    id: `t${highest + 1}`,
    name: draft.name,
    when: draft.when,
    instruction: draft.instruction,
    notify: draft.notify,
    status: 'active',
    timeZone: draft.timeZone,
    createdAt: now,
    updatedAt: now,
    nextAt,
    runs: 0,
    ...(draft.condition ? { condition: draft.condition } : {}),
    ...(draft.heartbeat ? { heartbeat: true } : {}),
    ...(draft.until !== undefined ? { until: draft.until } : {}),
    ...(draft.maxRuns !== undefined ? { maxRuns: draft.maxRuns } : {}),
    ...(draft.seen ? { seen: rememberSeen([], draft.seen), primed: true } : {}),
  };
  writeTriggers(dotId, (triggers) => [...triggers, trigger]);
  return { trigger };
};

export type TriggerPatch = Partial<Pick<DotTrigger, 'name' | 'when' | 'instruction' | 'notify' | 'until' | 'maxRuns' | 'condition' | 'heartbeat'>> & {
  clearUntil?: boolean;
  clearMaxRuns?: boolean;
  clearCondition?: boolean;
};

/** Changes what a trigger is or does. A new condition starts it afresh: a new first run, or a new first look. */
export const updateTrigger = (dotId: string, id: string, patch: TriggerPatch, now: number): TriggerChange => {
  const current = findTrigger(dotId, id);
  if (!current) return { error: `No trigger with id "${id}".` };
  if (current.status === 'ended') return { error: `${id} has ended. Create a new trigger instead.` };
  const { clearUntil, clearMaxRuns, clearCondition, ...fields } = patch;
  const next: DotTrigger = { ...current, ...fields, updatedAt: now };
  if (clearUntil) delete next.until;
  if (clearMaxRuns) delete next.maxRuns;
  if (clearCondition) delete next.condition;
  if (patch.when) {
    delete next.seen;
    delete next.fingerprint;
    delete next.contained;
    delete next.problem;
    next.primed = false;
    next.nextAt = isTimeTrigger(patch.when) ? nextFireAt(next, now) : now;
    if (next.nextAt === undefined) return { error: 'That condition would never fire.' };
  }
  if (next.until !== undefined && isTimeTrigger(next.when) && next.nextAt !== undefined && next.nextAt > next.until) {
    return { error: 'With that end, the trigger would never fire again. Check "until" and the schedule.' };
  }
  writeTriggers(dotId, (triggers) => triggers.map((trigger) => (trigger.id === id ? next : trigger)));
  return { trigger: next };
};

/** Pauses or resumes a trigger. Resuming re-plans a time trigger from now and primes an event trigger again. */
export const setTriggerPaused = (dotId: string, id: string, paused: boolean, now: number): TriggerChange => {
  const current = findTrigger(dotId, id);
  if (!current) return { error: `No trigger with id "${id}".` };
  if (current.status === 'ended') return { error: `${id} has ended.` };
  if ((current.status === 'paused') === paused) return { trigger: current };
  const next: DotTrigger = paused
    ? { ...current, status: 'paused', updatedAt: now }
    : {
      ...current,
      status: 'active',
      updatedAt: now,
      nextAt: isTimeTrigger(current.when) ? nextFireAt(current, now) : now,
      ...(isTimeTrigger(current.when) || current.when.type === 'spark_task' ? {} : { primed: false }),
    };
  if (!paused && next.nextAt === undefined) {
    const ended: DotTrigger = { ...current, status: 'ended', endedBecause: 'its time had passed', updatedAt: now };
    writeTriggers(dotId, (triggers) => triggers.map((trigger) => (trigger.id === id ? ended : trigger)));
    return { trigger: ended };
  }
  writeTriggers(dotId, (triggers) => triggers.map((trigger) => (trigger.id === id ? next : trigger)));
  return { trigger: next };
};

export const deleteTrigger = (dotId: string, id: string): boolean => {
  if (!findTrigger(dotId, id)) return false;
  writeTriggers(dotId, (triggers) => triggers.filter((trigger) => trigger.id !== id));
  return true;
};

/** Applies a patch to a trigger's bookkeeping (what it has seen, its next look, its problem). */
export const patchTrigger = (dotId: string, id: string, patch: Partial<DotTrigger>): void => {
  if (!getDotThread(dotId)) return;
  writeTriggers(dotId, (triggers) => triggers.map((trigger) => (trigger.id === id ? { ...trigger, ...patch } : trigger)));
};

/**
 * Records that a trigger fired: counts the run, plans the next one for a time trigger, and ends it when that was its
 * last. Returns the trigger as it is after the run.
 */
export const recordRun = (dotId: string, id: string, now: number, patch: Partial<DotTrigger> = {}): DotTrigger | undefined => {
  const current = findTrigger(dotId, id);
  if (!current) return undefined;
  const next: DotTrigger = { ...current, ...patch, runs: current.runs + 1, lastRunAt: now, updatedAt: now };
  if (isTimeTrigger(current.when)) next.nextAt = nextFireAt(current, now);
  const ending = current.when.type === 'once'
    ? 'it ran once, as planned'
    : next.maxRuns !== undefined && next.runs >= next.maxRuns
      ? `it ran ${next.runs} times, as many as planned`
      : next.until !== undefined && (isTimeTrigger(current.when) ? (next.nextAt ?? Infinity) > next.until : now > next.until)
        ? 'it reached its end date'
        : null;
  if (ending) {
    next.status = 'ended';
    next.endedBecause = ending;
    delete next.nextAt;
  }
  writeTriggers(dotId, (triggers) => triggers.map((trigger) => (trigger.id === id ? next : trigger)));
  return next;
};

/** Ends event triggers whose end date has passed without a run. Time triggers end when their next run would. */
export const endExpiredTriggers = (dotId: string, now: number): void => {
  const expired = triggersOf(getDotThread(dotId)?.runtime).filter((trigger) => trigger.status !== 'ended' && trigger.until !== undefined && now > trigger.until);
  if (!expired.length) return;
  const ids = new Set(expired.map((trigger) => trigger.id));
  writeTriggers(dotId, (triggers) => triggers.map((trigger) => (ids.has(trigger.id) ? { ...trigger, status: 'ended', endedBecause: 'it reached its end date', updatedAt: now, nextAt: undefined } : trigger)));
};

/** Routines from before triggers become schedule triggers, keeping their times, ends and next runs. */
export const migrateRoutines = (dotId: string, timeZone: string, now: number): void => {
  const thread = getDotThread(dotId);
  const routines: DotRoutine[] = thread?.runtime.routines ?? [];
  if (!thread || routines.length === 0) return;
  updateDotRuntime(dotId, (runtime) => {
    const triggers = [...triggersOf(runtime)];
    let highest = triggers.reduce((max, trigger) => Math.max(max, Number(trigger.id.slice(1)) || 0), 0);
    for (const routine of runtime.routines) {
      highest += 1;
      const when: DotTriggerWhen = routine.every === 'hour'
        ? { type: 'schedule', every: 'hours', interval: 1, minute: routine.minute ?? 0 }
        : routine.every === 'week'
          ? { type: 'schedule', every: 'week', at: routine.at ?? '09:00', days: routine.days?.length ? routine.days : [1] }
          : { type: 'schedule', every: routine.every, at: routine.at ?? '09:00' };
      const name = routine.instruction.replace(/\s+/g, ' ').trim();
      triggers.push({
        id: `t${highest}`,
        name: name.length > 48 ? `${name.slice(0, 47).trimEnd()}…` : name,
        when,
        instruction: routine.instruction,
        notify: 'important',
        status: 'active',
        timeZone,
        createdAt: routine.createdAt,
        updatedAt: now,
        nextAt: routine.nextAt,
        runs: 0,
        ...(routine.until !== undefined ? { until: routine.until } : {}),
      });
    }
    return { ...runtime, routines: [], triggers };
  });
};
