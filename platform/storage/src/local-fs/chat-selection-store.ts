import { atom } from 'nanostores';

/**
 * Counts USER-initiated chat selections.
 *
 * `activeChatId` changes for several reasons that are not a user picking a chat:
 * a rename adopts the new id, `saveLocalFSChat` adopts a real title over a temp
 * id, a delete clears it, and a workspace/account switch resets it. Only
 * `selectLocalFSInboxChat` is a real selection, so only it bumps this.
 *
 * ChatView needs the distinction to decide whether to blank the conversation
 * area while a body loads. Without it, renaming the chat you are reading blanks
 * it: rename sets `activeChatId` to the new id while `chatTitle` still holds the
 * old one, so ChatView's identity guard misses and the full load runs.
 *
 * A module-level atom rather than a field on LocalFSContext: that context value
 * is a bare object literal (no useMemo), so every consumer already re-renders on
 * every change — adding a field there would spread this signal across the whole
 * consumer tree instead of just the one component that reads it.
 */
export const chatSelectionEpoch = atom(0);

export const bumpChatSelectionEpoch = (): void => {
  chatSelectionEpoch.set(chatSelectionEpoch.get() + 1);
};
