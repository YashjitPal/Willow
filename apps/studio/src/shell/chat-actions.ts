/*
 * Chat actions that more than one surface raises, and the one storage key they
 * all agree on.
 *
 * Two surfaces now offer Pin / Rename / Delete for a chat: the Recents row's
 * three-dot menu, and Gemini's top-right conversation-actions menu. Only the
 * sidebar implements them. It owns the scope-guarded pin list, the rename
 * sanitizer and dup-check, the pin carry across a rename, and the Code-mode and
 * scanned-chat id maps — so the second surface asks rather than reimplements,
 * and there is still exactly one writer.
 *
 * A window event rather than context because the two surfaces sit in different
 * subtrees of StudioLayout, and this matches the `willow_disk_changed` pattern
 * already used across the shell.
 */

export type ChatActionName = 'pin' | 'rename' | 'delete';

export interface ChatActionIntent {
  action: ChatActionName;
  chatId: string;
}

export const CHAT_ACTION_INTENT_EVENT = 'willow_chat_action_intent';

export const emitChatActionIntent = (intent: ChatActionIntent): void => {
  window.dispatchEvent(new CustomEvent<ChatActionIntent>(CHAT_ACTION_INTENT_EVENT, { detail: intent }));
};

/** Subscribe to raised intents. Returns the unsubscriber, for a bare `useEffect` return. */
export const onChatActionIntent = (handler: (intent: ChatActionIntent) => void): (() => void) => {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<ChatActionIntent>).detail;
    if (detail && typeof detail.chatId === 'string') handler(detail);
  };
  window.addEventListener(CHAT_ACTION_INTENT_EVENT, listener);
  return () => window.removeEventListener(CHAT_ACTION_INTENT_EVENT, listener);
};

/*
 * The pinned-chats key, scoped per user/root/workspace.
 *
 * Shared because the pin row has to label itself "Pin" or "Unpin" before the
 * sidebar hears anything, so it reads this key directly. Reading is safe;
 * writing stays with the sidebar. `v2` and the encoding are load-bearing — an
 * un-encoded scope id can contain the separator and collide across scopes.
 */
export const pinnedChatsStorageKey = (chatScopeId: string): string =>
  `willow_pinned_chats:v2:${encodeURIComponent(chatScopeId)}`;

/** Whether `chatId` is pinned in `chatScopeId`. Never throws — a corrupt value reads as unpinned. */
export const isChatPinned = (chatScopeId: string, chatId: string): boolean => {
  try {
    const stored = localStorage.getItem(pinnedChatsStorageKey(chatScopeId));
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) && parsed.includes(chatId);
  } catch {
    return false;
  }
};
