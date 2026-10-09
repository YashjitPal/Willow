/**
 * A feature asking the shell to show another surface. Two exist, both Gemini's:
 *
 * - Chat's scheduled-action card has Edit, which opens the schedule in Spark's editor.
 * - Spark's Skills page "Create with Gemini" leaves Spark for a new chat that opens on
 *   "Create a skill" and Gemini's question back.
 *
 * App takes each request once (`App.tsx`). Features cannot reach App, and the Spark
 * location stays `unknown` here because `platform/*` imports nothing from `features/`.
 */
import { atom } from 'nanostores';

/** A chat that opens already holding one exchange. */
export interface ChatSeed {
  /** The user's message. */
  prompt: string;
  /** The reply under it, revealed as if it had just streamed in. */
  reply: string;
}

export type ShellRequest =
  | { id: number; surface: 'spark'; sparkLocation: unknown }
  | { id: number; surface: 'chat'; seed: ChatSeed };

export const pendingShellRequest = atom<ShellRequest | null>(null);

let nextRequestId = 1;

export const requestSparkLocation = (sparkLocation: unknown): void => {
  pendingShellRequest.set({ id: nextRequestId++, surface: 'spark', sparkLocation });
};

export const requestSeededChat = (seed: ChatSeed): void => {
  pendingShellRequest.set({ id: nextRequestId++, surface: 'chat', seed });
};

export const clearShellRequest = (id: number): void => {
  if (pendingShellRequest.get()?.id === id) pendingShellRequest.set(null);
};

/**
 * The seed the next new chat opens with. App sets it as it starts that chat, and the new
 * ChatView takes it as it mounts, so a chat already open never picks it up.
 */
export const pendingChatSeed = atom<ChatSeed | null>(null);

export const takeChatSeed = (): ChatSeed | null => {
  const seed = pendingChatSeed.get();
  if (seed) pendingChatSeed.set(null);
  return seed;
};
