import { useEffect } from "react";
import { type SavedAvatarImage, useCharacterStore } from "../../state/character-store";
import { sameBytes } from "../orbit/appearance-codec";
import { requestSavedAvatarCapture } from "./saved-avatar-capture";

/**
 * The saved avatar image of an orbit bot. Codex stores a server-rendered PNG with the profile;
 * the clone renders that PNG once, offscreen, with the same engine snapshot the save flow uploads.
 */
export function useSavedAvatarImage(conversationId: string | null, state: Uint8Array | null): SavedAvatarImage | null {
  const saved = useCharacterStore((s) => (conversationId == null ? undefined : s.savedImages[conversationId]));
  const current = saved != null && (state == null || sameBytes(saved.state, state)) ? saved : null;
  const needsCapture = conversationId != null && state != null && current == null;

  useEffect(() => {
    if (!needsCapture || conversationId == null || state == null) return;
    return requestSavedAvatarCapture(conversationId, state);
  }, [needsCapture, conversationId, state]);

  return current;
}
