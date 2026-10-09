import { atom } from 'nanostores';

/**
 * A task to open with its list collapsed and Progress showing: Gemini opens the task its
 * Schedules page's "Create with Gemini" starts that way. The task view takes the request
 * once, when it shows that task.
 */
export const sparkTaskListCollapseRequest = atom<string | null>(null);

export const requestSparkTaskListCollapsed = (taskId: string): void => {
  sparkTaskListCollapseRequest.set(taskId);
};
