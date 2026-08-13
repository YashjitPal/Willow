/**
 * The real `PersonalActions`, wired to Google.
 *
 * The one place where a tool call becomes a write to someone's account, so the
 * rules are stricter here than anywhere else in this package:
 *
 * - **No silent authorization.** A write scope is requested at connect time or by
 *   an explicit user gesture, never by a tool call. If the token is missing the
 *   action fails with text telling the user what to do. Popping an OAuth window
 *   because a model decided to create an event would be the app acting on the
 *   user's account without them present.
 * - **Every failure is a sentence.** Returned text goes back to the model, which
 *   tells the user. "Calendar isn't connected" is actionable; a thrown error is a
 *   broken turn.
 * - **Nothing is deleted or overwritten.** Every action here creates. Editing and
 *   deleting a user's real calendar from a chat message is not a thing this
 *   feature does.
 */

import { authLossHandler } from '../connectors/authorization';
import { createAuthorizedFetch } from '../connectors/authorized-fetch';
import { createTask as createGoogleTask } from '../connectors/google/tasks';
import { createDocument as createGoogleDocument } from '../connectors/google/docs';
import { isConnected } from '../connectors/connections-store';
import { writeScopesFor, tokensFor } from '../connectors/registry';
import { type TokenSource } from '../connectors/token-source';
import type { ConnectorId } from '../connectors/types';
import type { PersonalActions } from './executor';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';

const HOUR_MS = 60 * 60 * 1000;

const notConnected = (label: string): string =>
  `${label} is not connected. The user can connect it in Settings → Connected Apps.`;

const expired = (label: string): string =>
  `Willow's access to ${label} has expired. The user needs to reconnect it in Settings → Connected Apps.`;

/**
 * An authorized fetch for one connector's write scopes, or null.
 *
 * Uses `get`, never `request`: `get` returns a token already held and `request`
 * opens a popup. A tool call is not a user gesture, and a popup triggered by one
 * is both blocked by the browser and wrong in principle.
 */
const writeFetch = async (id: ConnectorId, override?: TokenSource) => {
  if (!isConnected(id)) return null;
  const scopes = writeScopesFor(id);
  if (scopes.length === 0) return null;
  // Per connector, not one global: a Spotify write scope asked of Google's token
  // source would open a consent screen listing scopes Google does not publish.
  const tokens = override ?? tokensFor(id);
  const token = await tokens.get(scopes);
  if (!token) return null;
  return createAuthorizedFetch({ tokens, scopes, onAuthLost: authLossHandler(id) });
};

/** An all-day date, or a timestamp — Calendar wants different fields for each. */
const timeField = (value: string): { date: string } | { dateTime: string } =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) ? { date: value } : { dateTime: value };

const oneHourLater = (start: string): string => {
  const parsed = Date.parse(start);
  if (!Number.isFinite(parsed)) return start;
  return new Date(parsed + HOUR_MS).toISOString();
};

/**
 * @param tokens Overrides every provider's source. For tests — in the app this is
 *   left out so each connector resolves its own, via `writeFetch`.
 */
export const createPersonalActions = (tokens?: TokenSource): PersonalActions => ({
  createTask: async ({ title, notes, due }) => {
    if (!isConnected('tasks')) return notConnected('Google Tasks');
    const fetchJson = await writeFetch('tasks', tokens);
    if (!fetchJson) return expired('Google Tasks');

    const task = await createGoogleTask(fetchJson, { title, notes, due });
    if (!task) return 'The task could not be created. Google Tasks rejected the request.';
    return due
      ? `Created the task "${title}", due ${due.slice(0, 10)}.`
      : `Created the task "${title}".`;
  },

  createCalendarEvent: async ({ title, start, end, description, location }) => {
    if (!isConnected('calendar')) return notConnected('Google Calendar');
    const fetchJson = await writeFetch('calendar', tokens);
    if (!fetchJson) return expired('Google Calendar');

    const allDay = /^\d{4}-\d{2}-\d{2}$/.test(start);
    const created = await fetchJson<{ id?: string; htmlLink?: string }>(
      `${CALENDAR_API}/calendars/primary/events`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: title,
          ...(description ? { description } : {}),
          ...(location ? { location } : {}),
          start: timeField(start),
          // Calendar rejects an event with no end. An hour is the conventional
          // default for a timed event; an all-day event ends the same day.
          end: timeField(end ?? (allDay ? start : oneHourLater(start))),
        }),
      },
    );

    if (!created?.id) return 'The event could not be created. Google Calendar rejected the request.';
    return `Created "${title}" on the user's calendar${allDay ? ` on ${start}` : ` starting ${start}`}.`;
  },

  createDocument: async ({ title, body }) => {
    // A Doc is created through Drive, so both must be connected: Docs supplies
    // the content scope and Drive supplies the file itself.
    if (!isConnected('docs')) return notConnected('Google Docs');
    if (!isConnected('drive')) {
      return 'Creating a document also needs Google Drive connected, since the document is a Drive file. The user can connect it in Settings → Connected Apps.';
    }
    const docsFetch = await writeFetch('docs', tokens);
    if (!docsFetch) return expired('Google Docs');

    const created = await createGoogleDocument(docsFetch, { title, body });
    if (!created) return 'The document could not be created. Google rejected the request.';
    return `Created the document "${created.title}": ${created.url}`;
  },

  createPlaylist: async ({ title, description }) => {
    if (!isConnected('youtube')) return notConnected('YouTube');
    const fetchJson = await writeFetch('youtube', tokens);
    if (!fetchJson) return expired('YouTube');

    const created = await fetchJson<{ id?: string }>(
      `${YOUTUBE_API}/playlists?part=snippet%2Cstatus`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snippet: { title, ...(description ? { description } : {}) },
          // Private by default. A playlist created on someone's behalf appearing
          // publicly on their channel is not a recoverable surprise.
          status: { privacyStatus: 'private' },
        }),
      },
    );

    if (!created?.id) return 'The playlist could not be created. YouTube rejected the request.';
    return `Created the private playlist "${title}". It is empty — videos cannot be added automatically, so the user will need to add them.`;
  },

  createSpotifyPlaylist: async ({ title, description, tracks }) => {
    if (!isConnected('spotify')) return notConnected('Spotify');
    const fetchJson = await writeFetch('spotify', tokens);
    if (!fetchJson) return expired('Spotify');

    const created = await createSpotifyPlaylistApi(fetchJson, { title, description });
    if (!created) return 'The playlist could not be created. Spotify rejected the request.';

    const wanted = (tracks ?? []).filter((entry) => entry.trim()).slice(0, MAX_PLAYLIST_TRACKS);
    if (wanted.length === 0) {
      return `Created the private Spotify playlist "${title}"${created.url ? `: ${created.url}` : ''}. It is empty — no tracks were given.`;
    }

    /*
     * One search per track, sequentially.
     *
     * Sequential because Spotify's rate limiter is per-application and a burst of
     * twenty parallel searches from one user is how the limit gets hit for
     * everybody. Slower and it is a background step inside one tool call.
     *
     * The first result is taken, which is a real limitation worth being honest
     * about in the returned text: "Weird Fishes" matches the original and nine live
     * versions, and Spotify's relevance ordering is the only judgement available
     * here. Naming the artist in the search is what makes it reliable, which is why
     * the tool description asks for "title — artist".
     */
    const uris: string[] = [];
    const missing: string[] = [];
    for (const entry of wanted) {
      const results = await searchSpotifyTracks(fetchJson, { q: entry, limit: 1 });
      const uri = results?.[0]?.uri;
      if (uri) uris.push(uri);
      else missing.push(entry);
    }

    if (uris.length === 0) {
      return `Created the private Spotify playlist "${title}"${created.url ? `: ${created.url}` : ''}, but none of the ${wanted.length} tracks could be found on Spotify. Tell the user the playlist is empty and which tracks were not found: ${missing.join('; ')}.`;
    }

    const added = await addSpotifyPlaylistItems(fetchJson, {
      playlistId: created.id,
      uris,
    });
    if (!added) {
      return `Created the private Spotify playlist "${title}"${created.url ? `: ${created.url}` : ''}, but adding the tracks failed. The playlist exists and is empty.`;
    }

    const shortfall = missing.length
      ? ` ${missing.length} could not be found on Spotify: ${missing.join('; ')}.`
      : '';
    return `Created the private Spotify playlist "${title}" with ${uris.length} track${uris.length === 1 ? '' : 's'}${created.url ? `: ${created.url}` : ''}.${shortfall}`;
  },
});
