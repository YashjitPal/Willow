import { atom } from 'nanostores';

/**
 * Hand-off for the two chat dialogs the notebook menu shares with Recents.
 *
 * The notebook row menu's **Rename** and **Delete** are the very same dialogs the
 * sidebar raises for an ordinary chat — measured identical, and confirmed by the
 * user: *"rename chat and delete chat seem to open the two menus which are already
 * there for normal chats as well so u can assign them too."*
 *
 * Those dialogs live as local state inside `Sidebar.tsx` (each with its own measured
 * open/close timing), so they cannot simply be imported. Rather than lift them out —
 * a large refactor of a component that is already pixel-verified — the notebook page
 * publishes a request here and the Sidebar, which is mounted unconditionally by
 * `StudioLayout`, opens its own dialog in response. One implementation, one set of
 * measurements, two callers.
 *
 * `consumed` is flipped rather than the atom cleared, for the same reason the
 * notebook chat hand-off does it: under StrictMode the consuming effect runs twice,
 * and a cleared atom makes the second pass look like a fresh request.
 */
export interface ChatDialogRequest {
  kind: 'rename' | 'delete';
  chatId: string;
  /** Distinguishes two consecutive requests for the same chat and kind. */
  id: number;
  consumed: boolean;
}

export const $chatDialogRequest = atom<ChatDialogRequest | null>(null);

let nextId = 0;

const request = (kind: ChatDialogRequest['kind'], chatId: string): void => {
  $chatDialogRequest.set({ kind, chatId, id: ++nextId, consumed: false });
};

/** Ask the shell to raise the shared "Rename this chat" dialog. */
export const requestChatRename = (chatId: string): void => request('rename', chatId);

/** Ask the shell to raise the shared "Delete chat" confirmation. */
export const requestChatDelete = (chatId: string): void => request('delete', chatId);

/** Take the pending request, if it has not already been handled. */
export const consumeChatDialogRequest = (): ChatDialogRequest | null => {
  const pending = $chatDialogRequest.get();
  if (!pending || pending.consumed) return null;
  $chatDialogRequest.set({ ...pending, consumed: true });
  return pending;
};
