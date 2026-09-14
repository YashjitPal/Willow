import { atom } from 'nanostores';

/**
 * The hand-off buffer for "reopen this Code chat in the workbench".
 *
 * A Code session's Recents row used to route through the sidebar's generic
 * `handleSelectChat`, which switches `studioMode` to `'chat'` — so the row
 * badged as a Code chat reopened in the normal chat UI. That is a one-way door:
 * ChatView's load allow-list drops every workbench field, and its autosave then
 * rewrites the file from React state, so sending one message erased
 * `willowMode: 'code'` from disk and even the badge went with it. A Code-marked
 * row now switches to `'develop'` and leaves the chat id here for the Code
 * surface to pick up.
 *
 * It has to be a buffer rather than an event: `CodeWorkspace` is lazy and is not
 * mounted at all while the user is in chat mode, so the request is published
 * before anything is listening. The consumer clears it, which is what stops a
 * later, unrelated return to the Code tab from reopening a chat the user did not
 * ask for.
 *
 * A module-level atom rather than a field on LocalFSContext, for the same reason
 * as `local-fs/chat-selection-store`: exactly one component reads it, and that
 * context value is a bare object literal, so putting it there would spread this
 * signal across every consumer in the tree.
 */
export interface CodeChatOpenRequest {
  chatId: string;
  /**
   * Bumped per request. The consumer keys its "already handled" check off this
   * rather than off `chatId`, so opening the same chat, leaving, and opening it
   * again is two requests rather than one repeat it ignores.
   */
  epoch: number;
}

export const pendingCodeChatOpen = atom<CodeChatOpenRequest | null>(null);

let requestEpoch = 0;

export const requestCodeChatOpen = (chatId: string): void => {
  if (!chatId) return;
  requestEpoch += 1;
  pendingCodeChatOpen.set({ chatId, epoch: requestEpoch });
};

export const clearCodeChatOpen = (): void => {
  if (pendingCodeChatOpen.get()) pendingCodeChatOpen.set(null);
};
