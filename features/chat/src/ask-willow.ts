import { atom } from 'nanostores';

/**
 * Ask Willow about selected text — the desktop app's right-click menu offers it on any page
 * (apps/studio/src/shell/rail/ContextMenu.tsx), and `AskWillow` answers it in the canvas's
 * floating window, beside the selection.
 */
export interface AskWillowRequest {
  /** Told apart from the last one, so a new selection starts a new window. */
  id: number;
  /** The selected text the questions are about. */
  text: string;
  /** Where the selection is on screen, in the page's own pixels — or the point clicked, where
   *  the selection has no box of its own here (inside a frame). */
  near: { left: number; top: number; right: number; bottom: number };
}

export const $askWillow = atom<AskWillowRequest | null>(null);

let next = 1;

export const askWillowAbout = (text: string, near: AskWillowRequest['near']): void => {
  $askWillow.set({ id: next++, text, near });
};

export const closeAskWillow = (): void => $askWillow.set(null);

/** How much of a selection goes with the question: enough for any passage, not a whole page. */
const MAX_SELECTION = 8000;

/** The first question carries the passage it is about, as the canvas's selection prompt does. */
export const askAboutPrompt = (selected: string, question: string): string => {
  const passage = selected.trim();
  const quoted = (passage.length > MAX_SELECTION ? `${passage.slice(0, MAX_SELECTION)}…` : passage).replace(/\n+/g, '\n> ');
  return `About this text:\n\n> ${quoted}\n\n${question}`;
};
