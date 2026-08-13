/**
 * Spotify.
 *
 * The best personalization source Willow has, and the reason is that Spotify will
 * answer a question no Google product will: what does this person actually listen
 * to. `/me/top/artists` is Spotify's own computed answer over a chosen time range.
 * YouTube, by comparison, exposes no watch history at all — the YouTube connector
 * can only see what was explicitly liked or subscribed to, which is why its caveat
 * exists.
 *
 * Taste is also unusually safe ground for a stored profile. A bullet saying someone
 * listens to a genre is the kind of fact this feature is for, where a calendar event
 * or an email subject is something it has to handle carefully. So the signal side
 * here is more generous than the others, and still bounded: genres and artist names,
 * never a track-by-track history.
 *
 * ### What is deliberately not read
 *
 * `user-read-currently-playing` and `user-read-playback-state` are not requested.
 * What someone is playing right now is presence data — it says whether they are at
 * their desk — and a profile builder that polls it is doing something other than
 * personalization. Taste is stable and worth storing; the current track is neither.
 *
 * ### The February 2026 API changes
 *
 * Spotify removed a lot in February 2026 and two of the removals shape this file:
 * batch fetches (`GET /tracks?ids=…`) are gone, so nothing here fans out over ids;
 * and playlist item routes moved from `/tracks` to `/items`, with the older
 * spellings deprecated. Both are used in their current form below.
 */

import { query } from '../authorized-fetch';
import type { ConnectorFetch, ConnectorReader, ConnectorSignal } from '../types';

const SPOTIFY_API = 'https://api.spotify.com/v1';

/** Enough to see a pattern, few enough to stay one request. */
const TOP_LIMIT = 30;
/** Spotify caps saved-track pages at 50. */
const SAVED_LIMIT = 50;

/** Genres seen this many times across top artists count as a real preference. */
const GENRE_THRESHOLD = 3;

interface Artist {
  id?: string;
  name?: string;
  genres?: string[];
  external_urls?: { spotify?: string };
}

interface Track {
  id?: string;
  uri?: string;
  name?: string;
  artists?: Artist[];
  album?: { name?: string; release_date?: string };
  external_urls?: { spotify?: string };
}

const artistNames = (track: Track): string =>
  (track.artists ?? []).map((artist) => artist.name).filter(Boolean).join(', ');

// ---------------------------------------------------------------------------
// Live reads — the detail a tool call needs and the profile deliberately drops.
// ---------------------------------------------------------------------------

export interface TopArtist {
  name: string;
  genres: string[];
  url?: string;
}

export interface TopTrack {
  title: string;
  artists: string;
  album?: string;
  url?: string;
  uri?: string;
}

/** Spotify's own time ranges. Roughly four weeks, six months, and several years. */
export type TimeRange = 'short_term' | 'medium_term' | 'long_term';

export const listTopArtists = async (
  fetchJson: ConnectorFetch,
  options: { limit?: number; timeRange?: TimeRange; signal?: AbortSignal } = {},
): Promise<TopArtist[] | null> => {
  const page = await fetchJson<{ items?: Artist[] }>(
    `${SPOTIFY_API}/me/top/artists${query({
      limit: Math.min(Math.max(options.limit ?? TOP_LIMIT, 1), 50),
      time_range: options.timeRange ?? 'medium_term',
    })}`,
    { signal: options.signal },
  );
  if (!page) return null;
  return (page.items ?? [])
    .filter((artist) => artist.name)
    .map((artist) => ({
      name: artist.name!,
      genres: artist.genres ?? [],
      ...(artist.external_urls?.spotify ? { url: artist.external_urls.spotify } : {}),
    }));
};

export const listTopTracks = async (
  fetchJson: ConnectorFetch,
  options: { limit?: number; timeRange?: TimeRange; signal?: AbortSignal } = {},
): Promise<TopTrack[] | null> => {
  const page = await fetchJson<{ items?: Track[] }>(
    `${SPOTIFY_API}/me/top/tracks${query({
      limit: Math.min(Math.max(options.limit ?? TOP_LIMIT, 1), 50),
      time_range: options.timeRange ?? 'medium_term',
    })}`,
    { signal: options.signal },
  );
  if (!page) return null;
  return (page.items ?? [])
    .filter((track) => track.name)
    .map((track) => ({
      title: track.name!,
      artists: artistNames(track),
      ...(track.album?.name ? { album: track.album.name } : {}),
      ...(track.external_urls?.spotify ? { url: track.external_urls.spotify } : {}),
      ...(track.uri ? { uri: track.uri } : {}),
    }));
};

export const listSavedTracks = async (
  fetchJson: ConnectorFetch,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<TopTrack[] | null> => {
  const page = await fetchJson<{ items?: { track?: Track }[] }>(
    `${SPOTIFY_API}/me/tracks${query({
      limit: Math.min(Math.max(options.limit ?? 25, 1), SAVED_LIMIT),
    })}`,
    { signal: options.signal },
  );
  if (!page) return null;
  return (page.items ?? [])
    .map((entry) => entry.track)
    .filter((track): track is Track => Boolean(track?.name))
    .map((track) => ({
      title: track.name!,
      artists: artistNames(track),
      ...(track.album?.name ? { album: track.album.name } : {}),
      ...(track.external_urls?.spotify ? { url: track.external_urls.spotify } : {}),
      ...(track.uri ? { uri: track.uri } : {}),
    }));
};

export interface Playlist {
  id: string;
  name: string;
  tracks: number;
  url?: string;
}

export const listPlaylists = async (
  fetchJson: ConnectorFetch,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<Playlist[] | null> => {
  const page = await fetchJson<{
    items?: { id?: string; name?: string; tracks?: { total?: number }; external_urls?: { spotify?: string } }[];
  }>(
    `${SPOTIFY_API}/me/playlists${query({ limit: Math.min(Math.max(options.limit ?? 25, 1), 50) })}`,
    { signal: options.signal },
  );
  if (!page) return null;
  return (page.items ?? [])
    .filter((entry) => entry.id && entry.name)
    .map((entry) => ({
      id: entry.id!,
      name: entry.name!,
      tracks: entry.tracks?.total ?? 0,
      ...(entry.external_urls?.spotify ? { url: entry.external_urls.spotify } : {}),
    }));
};

/**
 * Search Spotify's catalogue. Not user data — this is how a suggestion becomes a
 * playlist, since adding tracks needs URIs and the model has titles.
 *
 * `limit` maxes at 10 as of February 2026, down from 50.
 */
export const searchTracks = async (
  fetchJson: ConnectorFetch,
  options: { q: string; limit?: number; signal?: AbortSignal },
): Promise<TopTrack[] | null> => {
  const page = await fetchJson<{ tracks?: { items?: Track[] } }>(
    `${SPOTIFY_API}/search${query({
      q: options.q,
      type: 'track',
      limit: Math.min(Math.max(options.limit ?? 5, 1), 10),
    })}`,
    { signal: options.signal },
  );
  if (!page) return null;
  return (page.tracks?.items ?? [])
    .filter((track) => track.name)
    .map((track) => ({
      title: track.name!,
      artists: artistNames(track),
      ...(track.album?.name ? { album: track.album.name } : {}),
      ...(track.external_urls?.spotify ? { url: track.external_urls.spotify } : {}),
      ...(track.uri ? { uri: track.uri } : {}),
    }));
};

// ---------------------------------------------------------------------------
// Writes.
// ---------------------------------------------------------------------------

/** The current user's id, which `POST /me/playlists` needs in the path. */
const currentUserId = async (
  fetchJson: ConnectorFetch,
  signal?: AbortSignal,
): Promise<string | null> => {
  const me = await fetchJson<{ id?: string }>(`${SPOTIFY_API}/me`, { signal });
  return me?.id ?? null;
};

export const createPlaylist = async (
  fetchJson: ConnectorFetch,
  input: { title: string; description?: string; signal?: AbortSignal },
): Promise<{ id: string; url?: string } | null> => {
  const userId = await currentUserId(fetchJson, input.signal);
  if (!userId) return null;

  const created = await fetchJson<{ id?: string; external_urls?: { spotify?: string } }>(
    `${SPOTIFY_API}/users/${encodeURIComponent(userId)}/playlists`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: input.title,
        ...(input.description ? { description: input.description } : {}),
        // Private by default, like the YouTube half. A playlist created on
        // someone's behalf appearing publicly on their profile is not a
        // recoverable surprise.
        public: false,
      }),
      signal: input.signal,
    },
  );
  if (!created?.id) return null;
  return {
    id: created.id,
    ...(created.external_urls?.spotify ? { url: created.external_urls.spotify } : {}),
  };
};

/**
 * Add tracks to a playlist.
 *
 * `/items`, not `/tracks`: the `/tracks` spelling was deprecated in February 2026.
 * Spotify takes 100 URIs per request, which is far more than a chat ever produces.
 */
export const addPlaylistItems = async (
  fetchJson: ConnectorFetch,
  input: { playlistId: string; uris: string[]; signal?: AbortSignal },
): Promise<boolean> => {
  if (input.uris.length === 0) return false;
  const result = await fetchJson<{ snapshot_id?: string }>(
    `${SPOTIFY_API}/playlists/${encodeURIComponent(input.playlistId)}/items`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: input.uris.slice(0, 100) }),
      signal: input.signal,
    },
  );
  return Boolean(result?.snapshot_id);
};

// ---------------------------------------------------------------------------
// Signals — the aggregated half, for the stored profile.
// ---------------------------------------------------------------------------

const countBy = <T,>(items: T[], key: (item: T) => string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const value of key(item)) {
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return counts;
};

const topEntries = (counts: Map<string, number>, limit: number, threshold = 1): [string, number][] =>
  [...counts.entries()]
    .filter(([, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

/**
 * Genres and a few named artists — never the track list.
 *
 * The same rule the YouTube reader follows, and for the same reason: a list of
 * fifty tracks is a listening log, and a listening log in a file that is read into
 * every future prompt is not what someone connected Spotify for. The live tools
 * above are where the detail lives, used once and discarded.
 */
export const readSpotifySignals = async (
  fetchJson: ConnectorFetch,
  signal?: AbortSignal,
): Promise<ConnectorSignal[]> => {
  // `long_term` for the profile: several years of listening, which is the closest
  // thing to a stable fact about someone. A four-week window would rewrite the
  // profile every month on the strength of one album.
  const artists = await listTopArtists(fetchJson, {
    limit: TOP_LIMIT,
    timeRange: 'long_term',
    signal,
  });
  if (!artists || artists.length === 0) return [];

  const signals: ConnectorSignal[] = [];

  const genres = countBy(artists, (artist) => artist.genres);
  for (const [genre, count] of topEntries(genres, 4, GENRE_THRESHOLD)) {
    signals.push({
      section: 'interests',
      text: `Listens to ${genre}`,
      source: 'Spotify',
      evidence: `${count} of the user's most-played artists on Spotify are ${genre}.`,
    });
  }

  // Three names, not thirty. A handful of most-played artists is a fact about
  // someone's taste; the whole ranking is their listening history rewritten as
  // bullets, and it would lose the section's cap fight anyway.
  for (const artist of artists.slice(0, 3)) {
    signals.push({
      section: 'interests',
      text: `Listens to ${artist.name}`,
      source: 'Spotify',
      evidence: 'Among the user\'s most-played artists on Spotify over several years.',
    });
  }

  return signals;
};

export const spotifyConnector: ConnectorReader = {
  id: 'spotify',
  readSignals: readSpotifySignals,
};
