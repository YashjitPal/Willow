import { atom } from 'nanostores';

/**
 * What the shell needs to know about the mounted Code screens, by its name for
 * each (`screenKey`). This module stays tiny: App imports it, and the screens
 * themselves load lazily.
 */

/**
 * The screens running a turn. App reads it to keep a screen mounted, hidden,
 * when the user moves away from it: the turn lives in the screen's own state,
 * and unmounting it would drop the reply and the files it is writing.
 */
export const $runningCodeScreens = atom<readonly string[]>([]);

export function setCodeScreenRunning(screenKey: string, running: boolean): void {
  const current = $runningCodeScreens.get();
  if (running === current.includes(screenKey)) return;
  $runningCodeScreens.set(running ? [...current, screenKey] : current.filter((key) => key !== screenKey));
}

/**
 * The project folder each screen autosaves into. Two screens on one folder
 * would write over each other, so App opens a project where it is already open
 * rather than in a second screen, and a closed tab's turn on it waits.
 */
export const $codeScreenProjects = atom<Readonly<Record<string, string>>>({});

export function setCodeScreenProject(screenKey: string, projectName: string | null): void {
  setEntry($codeScreenProjects, screenKey, projectName);
}

/**
 * The conversation each screen has open (its chat id), so opening a chat that
 * one already has shows that screen as it is, a running turn and all, instead
 * of reading the chat back into another.
 */
export const $codeScreenChats = atom<Readonly<Record<string, string>>>({});

export function setCodeScreenChat(screenKey: string, chatId: string | null): void {
  setEntry($codeScreenChats, screenKey, chatId);
}

function setEntry(store: typeof $codeScreenProjects, screenKey: string, value: string | null): void {
  const current = store.get();
  if ((current[screenKey] ?? null) === value) return;
  const next = { ...current };
  if (value) next[screenKey] = value;
  else delete next[screenKey];
  store.set(next);
}
