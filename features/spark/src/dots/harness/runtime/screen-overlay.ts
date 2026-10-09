/**
 * Windows' overlay — the glow, the pill with Stop and Esc, the bot's own cursor (`screen/screen-overlay.cs`) — follows
 * a bot's grant of the user's screen: shown with the bot's name and colour from its first use of the screen under a
 * grant, and taken down when that grant ends or the bot's turn does. One bot holds the overlay at a time; another bot
 * ending its grant leaves the one showing alone. Elsewhere `begin` and `end` show nothing.
 */
import type { DotScreenBridge } from './screen-bridge';

let showing: { dotId: string; grant: string } | null = null;

/** Which bot's grant the overlay shows, if any. */
export const screenOverlayShowing = (): { dotId: string; grant: string } | null => showing;

export const showScreenOverlay = async (bridge: DotScreenBridge, show: { dotId: string; grant: string; name: string; color?: string }): Promise<void> => {
  if (showing?.dotId === show.dotId && showing.grant === show.grant) return;
  showing = { dotId: show.dotId, grant: show.grant };
  try {
    await bridge.begin({ name: show.name, ...(show.color ? { color: show.color } : {}), grant: show.grant, session: show.dotId });
  } catch {
    if (showing?.grant === show.grant) showing = null;
  }
};

export const hideScreenOverlay = async (bridge: DotScreenBridge, dotId: string): Promise<void> => {
  if (!showing || showing.dotId !== dotId) return;
  showing = null;
  await bridge.end().catch(() => undefined);
};

/** The overlay went down by itself: the user stopped the bot from it. */
export const forgetScreenOverlay = (dotId: string): void => {
  if (showing?.dotId === dotId) showing = null;
};
