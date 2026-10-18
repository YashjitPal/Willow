/**
 * What the Scheduled tab does to Spark: its schedules are Spark's, and its runs, "Go to chat"
 * and the composer's tasks are Spark tasks, opened in Spark the way the sidebar's Spark rows
 * open them (`@willow/core/shell-request`).
 */
import { atom } from 'nanostores';
import { requestSparkLocation } from '@willow/core/shell-request';
import {
  createSparkSchedule,
  deleteSparkSchedule,
  sparkState,
  updateSparkSchedule,
  type SparkScheduleInput,
} from '../spark-store';
import { getFirstScheduleRunAt, getNextScheduleRunAt } from '../spark-schedule-time';
import { waitForSparkTaskHost } from '../spark-task-host';
import type { SparkLocation, SparkSchedule } from '../spark-types';

const scheduleById = (scheduleId: string): SparkSchedule | undefined =>
  sparkState.get().schedules.find((schedule) => schedule.id === scheduleId);

/** A new schedule from the editor: on, and due at its first run. It has no chat until it runs. */
export const createScheduleFromForm = (input: Omit<SparkScheduleInput, 'enabled'>): SparkSchedule | null => {
  const nextRunAt = getFirstScheduleRunAt(input);
  return createSparkSchedule({ ...input, enabled: true, nextRunAt, completedAt: nextRunAt ? undefined : new Date().toISOString() });
};

/** An edit from the editor. A schedule that is on is due again by its new timing. */
export const saveScheduleFromForm = (scheduleId: string, input: Omit<SparkScheduleInput, 'enabled'>): SparkSchedule | null => {
  const existing = scheduleById(scheduleId);
  if (!existing) return null;
  const nextRunAt = getFirstScheduleRunAt(input);
  return updateSparkSchedule(scheduleId, {
    ...input,
    nextRunAt: existing.enabled ? nextRunAt : existing.nextRunAt,
    completedAt: nextRunAt ? undefined : existing.completedAt ?? new Date().toISOString(),
  });
};

export const pauseSchedule = (scheduleId: string): SparkSchedule | null => updateSparkSchedule(scheduleId, { enabled: false });

export const resumeSchedule = (scheduleId: string): SparkSchedule | null => {
  const existing = scheduleById(scheduleId);
  if (!existing) return null;
  return updateSparkSchedule(scheduleId, { enabled: true, nextRunAt: getNextScheduleRunAt(existing) });
};

export const deleteSchedule = (scheduleId: string): boolean => deleteSparkSchedule(scheduleId);

/**
 * Run now: one run at once, in a Spark task of its own, as a scheduled run starts. The schedule
 * keeps its next regular run, and this run reports back to it like any other.
 */
export const runScheduleNow = async (scheduleId: string): Promise<boolean> => {
  const schedule = scheduleById(scheduleId);
  if (!schedule) return false;
  const host = await waitForSparkTaskHost();
  if (!host) return false;
  const taskId = host.startTask(schedule.instructions, { title: schedule.title, description: 'Scheduled task started' });
  if (!taskId) return false;
  updateSparkSchedule(scheduleId, { taskId, lastRunLabel: 'Running...' });
  return true;
};

const openSparkTask = (taskId: string): void => {
  const location: SparkLocation = { page: 'task', taskId };
  requestSparkLocation(location);
};

/** "Go to chat": the Spark task the schedule last ran in. */
export const openScheduleChat = (schedule: Pick<SparkSchedule, 'taskId'>): void => {
  if (schedule.taskId && sparkState.get().tasks.some((task) => task.id === schedule.taskId)) openSparkTask(schedule.taskId);
};

/** The composer and the Suggested rows: a Spark task with the request, opened, as Gemini starts one. */
export const startScheduledTask = async (prompt: string): Promise<boolean> => {
  const text = prompt.trim();
  if (!text) return false;
  const host = await waitForSparkTaskHost();
  if (!host) return false;
  const taskId = host.startTask(text);
  if (!taskId) return false;
  openSparkTask(taskId);
  return true;
};

/** A schedule the tab should open its editor on when it shows next: Chat's schedule card Edit. */
export const scheduledPaneRequest = atom<string | null>(null);

export const requestScheduledPane = (scheduleId: string): void => {
  scheduledPaneRequest.set(scheduleId);
};
