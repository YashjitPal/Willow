/**
 * The "New Chat" broadcast.
 *
 * One surface asks for a fresh thread and a different one performs the reset, so
 * the two need a channel that belongs to neither. Code's `WorkbenchTopBar` fires
 * it and Code's `WorkbenchSidebar` listens.
 *
 * It sat in `features/chat/src/chat-store.ts` and was imported across the
 * feature boundary as `@willow/chat/chat-store`, which read as Code depending on
 * Chat — while Chat itself never touched it. Chat holds its thread in
 * `ChatView`'s own `useState` and resets locally, so nothing in Chat ever
 * subscribed. A counter with no UI and no chat state is shared vocabulary, which
 * puts it here.
 *
 * The value carries no meaning beyond "changed": subscribers react to the
 * increment, they never read the number.
 */

import { atom } from 'nanostores';

export const newChatSignal = atom<number>(0);

export function triggerNewChat() {
  newChatSignal.set(newChatSignal.get() + 1);
}
