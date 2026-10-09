import type { SparkBrowserRequest, SparkTask } from '../spark-types';

/** A browser request and the turn that shows it: `null` is the root task. */
export interface LocatedBrowserRequest {
  request: SparkBrowserRequest;
  turnId: string | null;
}

/** The request by id, wherever it sits in the thread. */
export const findBrowserRequest = (task: SparkTask, requestId: string): LocatedBrowserRequest | null => {
  if (task.browserRequest?.id === requestId) return { request: task.browserRequest, turnId: null };
  for (const turn of task.turns ?? []) {
    if (turn.browserRequest?.id === requestId) return { request: turn.browserRequest, turnId: turn.id };
  }
  return null;
};

/** The request the thread is waiting on, if any. Only the latest turn can be waiting. */
export const pendingBrowserRequest = (task: SparkTask): LocatedBrowserRequest | null => {
  const last = task.turns?.at(-1);
  if (last) return last.browserRequest?.status === 'pending' ? { request: last.browserRequest, turnId: last.id } : null;
  return task.browserRequest?.status === 'pending' ? { request: task.browserRequest, turnId: null } : null;
};

/**
 * Whether the task is waiting on the browser permission card.
 *
 * The request is required, not just the status: `request_user_input` also puts
 * a task in `needs-input`, and a question must not raise a card about the browser.
 */
export const isAwaitingBrowserPermission = (task: SparkTask): boolean =>
  task.status === 'needs-input' && Boolean(pendingBrowserRequest(task));

/**
 * Whether the task's browser has ever opened, so the header can offer it again.
 * Gemini adds its monitor button when the browser starts, not when it is requested.
 */
export const hasOpenedRemoteBrowser = (task: SparkTask): boolean => Boolean(task.remoteBrowser);
