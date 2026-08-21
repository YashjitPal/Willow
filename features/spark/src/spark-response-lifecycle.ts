import type { SparkTask, SparkTaskTurn } from './spark-types';

const isTaskRunning = (task: SparkTask): boolean =>
  task.status === 'queued' || task.status === 'running';

/** The root response owns only the original task run, never a follow-up run. */
export const isSparkRootResponseStreaming = (task: SparkTask): boolean =>
  isTaskRunning(task) && task.turns.length === 0;

/** Only the latest follow-up can own the task's active run. */
export const isSparkTurnResponseStreaming = (
  task: SparkTask,
  turn: SparkTaskTurn,
): boolean => isTaskRunning(task) && task.turns.at(-1)?.id === turn.id;

export const hasSparkResponseStarted = (response: string): boolean =>
  response.trim().length > 0;
