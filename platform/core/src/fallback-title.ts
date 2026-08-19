/**
 * What a chat or project is called when the naming model cannot name it.
 *
 * Naming runs against whichever model the user picked in Settings -> Models and
 * API -> System defaults, so it fails for reasons Willow does not control: a
 * quota error, a revoked key, a provider outage, a model id that has been
 * retired. Every naming surface used to react to that differently, and two of
 * them did nothing at all — the Workbench title effects skipped the rename, so
 * the chat kept its temp id and the sidebar skeleton shimmered for the rest of
 * the session.
 *
 * The first prompt is the fallback because it is already the only thing the
 * naming model was given. If it was enough to name the session from, it is
 * enough to name the session with.
 */

/** The last resort for a chat, when its first prompt is too long to be a label. */
export const FALLBACK_CHAT_TITLE = 'New Conversation';

/**
 * The longest first prompt still usable as a title.
 *
 * A sidebar row fits roughly this much before it ellipsizes, and a prompt longer
 * than that is a paragraph rather than a label — which is the reason a naming
 * model gets asked in the first place.
 */
export const FALLBACK_TITLE_MAX_CHARS = 60;

/** Forbidden in a path segment on Windows or POSIX. A title becomes a folder name on disk. */
const ILLEGAL_PATH_CHARS = /[\/:*?"<>|]/g;

/**
 * Turns the prompt that was sent for naming into a title, or returns `lastResort`.
 *
 * `lastResort` is per surface rather than a constant: a chat falls back to
 * `FALLBACK_CHAT_TITLE`, a Code project to 'New Project', because a project card
 * labelled "New Conversation" describes the wrong kind of thing.
 */
export const deriveFallbackTitle = (
  prompt: string | null | undefined,
  lastResort: string,
): string => {
  const collapsed = (prompt ?? '')
    .replace(ILLEGAL_PATH_CHARS, '')
    // Newlines and runs of spaces collapse to one space: a pasted multi-line
    // prompt is still a single-line label.
    .replace(/\s+/g, ' ')
    // Windows silently drops trailing dots and spaces from a directory name, so
    // a title ending in one no longer matches the folder it created. A leading
    // dot hides the entry on POSIX and collides with the dot-files the storage
    // layer owns.
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (!collapsed || collapsed.length > FALLBACK_TITLE_MAX_CHARS) return lastResort;
  return collapsed;
};
