import { create } from "zustand";
import { persist } from "zustand/middleware";

const RECENT_EMOJI_LIMIT = 16;

interface RecentEmojiState {
  recentEmojis: string[];
  rememberEmoji: (emoji: string) => void;
}

/** `$e` (persisted atom `emoji-recent-v1`): emoji picked in any symbol picker, newest first. */
export const useRecentEmojiStore = create<RecentEmojiState>()(
  persist(
    (set) => ({
      recentEmojis: [],
      rememberEmoji: (emoji) =>
        set((state) => ({ recentEmojis: [emoji, ...state.recentEmojis.filter((recent) => recent !== emoji)].slice(0, RECENT_EMOJI_LIMIT) })),
    }),
    {
      name: "codex-clone-emoji-recent-v1",
      partialize: ({ recentEmojis }) => ({ recentEmojis }),
    },
  ),
);
