/**
 * The task timeline's command rows, from the desktop app's native runtime.
 *
 * Consecutive commands share one collapsible row, drawn as the sub-agent group is:
 * "Running command" while one is still waiting or running, then "Ran command" (or
 * "Ran commands"), with each command on the dotted line beneath when expanded.
 * The web runtime's sandbox operations carry no label and keep their own rows.
 */

import type { SparkActivityEntry, SparkCommandRowStatus } from './spark-types';

export type SparkToolEntry = Extract<SparkActivityEntry, { kind: 'tool' }>;

/**
 * A command the desktop app ran on this computer: a `command` row that carries the command.
 * Deliberately not a type guard: a tool row that is not a command is still a tool row.
 */
export const isCommandRow = (entry: SparkActivityEntry): boolean =>
  entry.kind === 'tool' && entry.tool === 'command' && Boolean(entry.label?.trim());

const isWaitingOrRunning = (status: SparkCommandRowStatus | undefined) => status === 'queued' || status === 'running';

/**
 * Whether a group of commands is still at work. `active` is whether the turn is;
 * a row recorded before rows carried a status counts as running only while it is
 * the last thing on the timeline.
 */
export const isCommandGroupRunning = (entries: readonly SparkToolEntry[], active: boolean, trailing: boolean): boolean => {
  if (!active) return false;
  const tracked = entries.some((entry) => entry.status);
  return tracked ? entries.some((entry) => isWaitingOrRunning(entry.status)) : trailing;
};

/** "Running command", "Ran commands", or "Didn't run command" when every one was declined. */
export const commandGroupLabel = (entries: readonly SparkToolEntry[], running: boolean): string => {
  const noun = entries.length > 1 ? 'commands' : 'command';
  if (running) return `Running ${noun}`;
  if (entries.length && entries.every((entry) => entry.status === 'cancelled')) return `Didn't run ${noun}`;
  return `Ran ${noun}`;
};

/** `activityLog` with the row for `callId` set to `status`, or null when nothing changes. */
export const withCommandRowStatus = (
  activityLog: readonly SparkActivityEntry[],
  callId: string,
  status: unknown,
): SparkActivityEntry[] | null => {
  if (status !== 'queued' && status !== 'running' && status !== 'success' && status !== 'error' && status !== 'cancelled') return null;
  const index = activityLog.findIndex((entry) => entry.kind === 'tool' && entry.callId === callId);
  const entry = activityLog[index];
  if (!entry || entry.kind !== 'tool' || entry.status === status) return null;
  const next = [...activityLog];
  next[index] = { ...entry, status };
  return next;
};
