import { atom } from 'nanostores';

/**
 * Whether the chat's context side-panel (thinking steps, sources, or resource
 * preview) is currently open. Written by ChatView, read by the shell's
 * ConversationActionsMenu to hide itself while the panel occupies that corner.
 *
 * An atom rather than a DOM event because the shell reads it synchronously on
 * every render — polling a ref from another tree is fragile, and an event
 * would need a matching "closed" counterpart plus cleanup, which nanostores
 * already handles.
 */
export const $chatPanelOpen = atom(false);
