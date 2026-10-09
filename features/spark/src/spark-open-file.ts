import { atom } from 'nanostores';

/**
 * The created file each task shows in its side panel, by task id: Gemini's
 * `remy-side-panel.showing-embedded-doc`. Outside the task view, which is one
 * instance for every task, so each task keeps its own; a reload closes them all,
 * as it closes the remote browser.
 */
export const sparkOpenFiles = atom<Readonly<Record<string, string>>>({});

export const openSparkFile = (taskId: string, fileId: string): void => {
  if (sparkOpenFiles.get()[taskId] === fileId) return;
  sparkOpenFiles.set({ ...sparkOpenFiles.get(), [taskId]: fileId });
};

export const closeSparkFile = (taskId: string): void => {
  if (!(taskId in sparkOpenFiles.get())) return;
  const next = { ...sparkOpenFiles.get() };
  delete next[taskId];
  sparkOpenFiles.set(next);
};
