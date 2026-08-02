import { atom } from 'nanostores';

// Signal atom: increments each time "New Chat" is triggered from outside the sidebar
// (e.g. from the collapsed TopBar). The Sidebar subscribes and resets chat state.
export const newChatSignal = atom<number>(0);

export function triggerNewChat() {
  newChatSignal.set(newChatSignal.get() + 1);
}
