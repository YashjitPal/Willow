import { create } from 'zustand';
import { sendSparkDotMessage } from '../../../../dots/dots-store';

/** The signed-in user's id in the mocked Spaces data (Codex's `selfUserId`). */
export const selfUserId = 'user-self';

export interface RoomRecord {
  id: string;
}

/**
 * The slice of Codex's bot room store Spaces uses: a Page's request to a bot,
 * which lands in the bot's Willow conversation, and the room a bot's
 * conversation lives in. A Willow bot's room is its conversation, so the room
 * id is the bot id.
 */
interface RoomStore {
  sendOutcome: 'delivered' | 'failed' | 'unknown';
  ensureRoom: (conversationId: string) => { room: RoomRecord };
  send: (conversationId: string, text: string) => void;
}

export const useRoomStore = create<RoomStore>(() => ({
  sendOutcome: 'delivered',
  ensureRoom: (conversationId) => ({ room: { id: conversationId } }),
  send: (conversationId, text) => sendSparkDotMessage(conversationId, text),
}));
