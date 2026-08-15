/**
 * The real `PersonalReads`, wired to the connectors.
 *
 * The read counterpart to `actions.ts`, and it inherits two of that file's rules
 * unchanged:
 *
 * - **No silent authorization.** Read scopes are granted when the user connects the
 *   product, so a read tool never needs to ask for anything — and if the token has
 *   expired it says so rather than opening a popup. `tokens.get`, never
 *   `tokens.request`. A tool call is not a user gesture.
 * - **Every failure is a sentence.** The text goes back to the model, which tells
 *   the user. "YouTube needs reconnecting" is actionable.
 *
 * And adds one of its own, which is the whole reason the failure text here is more
 * insistent than on the action side. A failed write is self-announcing: nothing was
 * created and the user finds out. A failed read is silent, and a model handed
 * nothing will fill the gap — it will answer a question about the user's own liked
 * videos with plausible videos. So every failure names the product, says what to do,
 * and tells the model not to guess; and "no results" and "could not read" are never
 * the same string.
 *
 * Nothing here is stored. A live read exists for one reply and is then gone, which
 * is what lets it keep the detail the profile deliberately throws away — the titles,
 * the subject lines, the actual events.
 */

import { authLossHandler, markAuthorized, markExpired } from '../connectors/authorization';
import { createAuthorizedFetch } from '../connectors/authorized-fetch';
import { isConnected } from '../connectors/connections-store';
import { authLossStatusesFor, readScopesFor, tokensFor } from '../connectors/registry';
import { type TokenSource } from '../connectors/token-source';
import type { ConnectorFetch, ConnectorId } from '../connectors/types';
import { listScheduledEvents as fetchEvents } from '../connectors/google/calendar';
import { listOpenTasks as fetchTasks } from '../connectors/google/tasks';
import { listRecentMail as fetchMail } from '../connectors/google/gmail';
import {
  listLikedVideos as fetchLikedVideos,
  listSubscriptions as fetchSubscriptions,
} from '../connectors/google/youtube';
import {
  listPlaylists as fetchPlaylists,
  listSavedTracks as fetchSavedTracks,
  listTopArtists as fetchTopArtists,
  listTopTracks as fetchTopTracks,
  type TimeRange,
} from '../connectors/spotify/spotify';
import {
  isPullRequestFilter,
  listActiveRepos as fetchRepos,
  listAssignedIssues as fetchIssues,
  listPullRequests as fetchPullRequests,
  type GithubItem,
  type GithubRepo,
  type PullRequestFilter,
} from '../connectors/github/github';
import { readGithubLogin } from '../connectors/github/session-store';
import { profileStore } from '../profile/profile-store';
import type { PersonalReads } from './executor';

const notConnected = (label: string): string =>
  `${label} is not connected, so there is nothing to read. The user can connect it in Settings → Connected Apps. Do not guess at what it would have said.`;

const expired = (label: string): string =>
  `Willow's access to ${label} has expired, so this could not be read. The user needs to reconnect it in Settings → Connected Apps. Tell them that — do not answer as though the data were unavailable for some other reason, and do not invent it.`;

/**
 * Personal Intelligence off means Willow does not know who the user is.
 *
 * Belt and braces: the chat pipeline already declines to declare these tools when
 * the switch is off, so a model should never get here. It is checked again because
 * the two gates protect different things — the declaration gate stops the model
 * being told the feature exists, and this one stops a request reaching Google's
 * servers with the user's token attached. The switch is a promise about the second
 * one, and a promise about network traffic is worth enforcing where the traffic is.
 */
const SWITCHED_OFF =
  'Personal Intelligence is turned off, so Willow cannot read the user\'s connected apps. They can turn it back on in Settings → Personal Intelligence.';

type Ready = { fetchJson: ConnectorFetch } | { error: string };

/**
 * An authorized read fetch for one connector, or the sentence explaining why not.
 *
 * `'error' in gate` is how callers tell the two apart. A boolean discriminant would
 * read better and would not narrow: `strictNullChecks` is off in this repo, and a
 * union discriminated on a boolean stays un-narrowed where an `in` check works.
 */
const ready = async (id: ConnectorId, label: string, override?: TokenSource): Promise<Ready> => {
  if (!profileStore.get().enabled) return { error: SWITCHED_OFF };
  if (!isConnected(id)) return { error: notConnected(label) };
  const scopes = readScopesFor(id);
  if (scopes.length === 0) return { error: notConnected(label) };
  // Per connector, so a Spotify read asks Spotify. One global source would send
  // `user-top-read` to Google, which has never heard of it.
  const tokens = override ?? tokensFor(id);
  const token = await tokens.get(scopes);
  if (!token) {
    // Withdraws the tool for the next turn. Reaching here at all means the tool
    // was declared on stale authorization, so the useful thing is to make sure it
    // is not declared again rather than to report the same failure every message.
    markExpired(id);
    return { error: expired(label) };
  }
  markAuthorized(id);
  return {
    fetchJson: createAuthorizedFetch({
      tokens,
      scopes,
      authLossStatuses: authLossStatusesFor(id),
      onAuthLost: authLossHandler(id),
    }),
  };
};

type GithubReady = { fetchJson: ConnectorFetch; login: string } | { error: string };

/**
 * GitHub's gate: the usual one, plus whose account this is.
 *
 * Every GitHub read is a search qualified by the user's own login — `involves:octocat`
 * — so a token with no login stored beside it is authorized and still cannot ask a
 * question. `saveGithubToken` stores the two together, so this only comes up for a
 * token left by an older build; the fix is the same as for an expired one, which is why
 * it reports the same sentence rather than inventing a state the user cannot act on
 * differently.
 */
const readyGithub = async (override?: TokenSource): Promise<GithubReady> => {
  const gate = await ready('github', 'GitHub', override);
  if ('error' in gate) return gate;
  const login = readGithubLogin();
  if (!login) return { error: expired('GitHub') };
  return { fetchJson: gate.fetchJson, login };
};

/** `2026-08-14T15:00:00-04:00` → `2026-08-14 15:00`; a plain date is left alone. */
const shortTime = (value: string): string =>
  value.includes('T') ? `${value.slice(0, 10)} ${value.slice(11, 16)}` : value;

/**
 * `Tue, 11 Aug 2026 14:03:22 -0400` → `11 Aug 2026 14:03`.
 *
 * The `Date` header is whatever the sending server wrote, so anything unexpected is
 * passed through rather than mangled — a slightly long date is better than a wrong
 * one.
 */
const shortMailDate = (value: string): string => {
  const match = value.match(/(\d{1,2}\s+\w{3}\s+\d{4})\s+(\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]}` : value;
};

const lines = (header: string, body: string[]): string => [header, ...body].join('\n');

/** How Spotify's three windows read in a sentence. */
const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  short_term: 'the last four weeks',
  medium_term: 'the last six months',
  long_term: 'several years',
};

/**
 * A model's `time_range` argument, or the sensible default.
 *
 * Six months is the default rather than Spotify's own `medium_term` naming being
 * passed through blindly: it is long enough not to swing on one album and short
 * enough to describe someone now. An unrecognised value falls back rather than
 * failing — a model that writes "6months" should get an answer, not an error.
 */
const asTimeRange = (value: string | undefined): TimeRange =>
  value === 'short_term' || value === 'long_term' || value === 'medium_term'
    ? value
    : 'medium_term';

/**
 * How each pull-request filter reads in a sentence.
 *
 * Written to slot into both "Open GitHub pull requests …, most recently updated first"
 * and "No open pull requests …", because those two must agree. An empty result is an
 * answer and has to name the same question that was asked — "no open pull requests"
 * where the model asked for review requests would read as "you have none at all".
 */
const PR_FILTER_LABELS: Record<PullRequestFilter, string> = {
  involves: 'that the user opened, was assigned, was mentioned in, or was asked to review',
  author: 'the user opened',
  assigned: 'assigned to the user',
  'review-requested': "waiting on the user's review",
};

/** `owner/repo#12 — "Title" [draft] (by octocat, updated 2026-08-14 15:00, 3 comments) url` */
const githubItemLine = (item: GithubItem): string => {
  const detail = [
    item.author ? `by ${item.author}` : null,
    item.updated ? `updated ${shortTime(item.updated)}` : null,
    item.comments > 0 ? `${item.comments} comment${item.comments === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(', ');
  const where = item.repo ? `${item.repo}#${item.number}` : `#${item.number}`;
  return `- ${where} — "${item.title}"${item.draft ? ' [draft]' : ''}${detail ? ` (${detail})` : ''}${item.url ? ` ${item.url}` : ''}`;
};

const githubRepoLine = (repo: GithubRepo): string => {
  const facts = [
    repo.language || null,
    repo.pushed ? `last push ${repo.pushed.slice(0, 10)}` : null,
  ].filter(Boolean).join(', ');
  return `- ${repo.name}${repo.private ? ' [private]' : ''}${facts ? ` (${facts})` : ''}${repo.description ? ` — ${repo.description}` : ''}`;
};

/**
 * `tokens` is an override for tests only.
 *
 * Left undefined in the app, because the right source depends on the connector:
 * Google's connectors share the GIS source and Spotify has its own PKCE one, and
 * `ready` resolves that per call. A single source passed here would send Spotify
 * requests a Google token and every read would 401.
 */
export const createPersonalReads = (tokens?: TokenSource): PersonalReads => ({
  listLikedVideos: async ({ limit }) => {
    const gate = await ready('youtube', 'YouTube', tokens);
    if ('error' in gate) return gate.error;

    const videos = await fetchLikedVideos(gate.fetchJson, { limit });
    if (!videos) return expired('YouTube');
    if (videos.length === 0) {
      return 'The user has not liked any videos on YouTube. Say so rather than suggesting what they might have liked.';
    }

    return lines(
      `The user's ${videos.length} most recently liked YouTube videos, newest first. This is their liked list, not their watch history — YouTube provides no watch history to any app.`,
      videos.map((video) => {
        const channel = video.channel ? ` — ${video.channel}` : '';
        return `- "${video.title}"${channel}${video.url ? ` (${video.url})` : ''}`;
      }),
    );
  },

  listSubscriptions: async ({ limit }) => {
    const gate = await ready('youtube', 'YouTube', tokens);
    if ('error' in gate) return gate.error;

    const channels = await fetchSubscriptions(gate.fetchJson, { limit });
    if (!channels) return expired('YouTube');
    if (channels.length === 0) return 'The user subscribes to no YouTube channels.';

    return lines(
      `The user subscribes to these ${channels.length} YouTube channels, most relevant first:`,
      channels.map((channel) => `- ${channel.title}${channel.url ? ` (${channel.url})` : ''}`),
    );
  },

  listCalendarEvents: async ({ daysAhead, daysBack }) => {
    const gate = await ready('calendar', 'Google Calendar', tokens);
    if ('error' in gate) return gate.error;

    const ahead = daysAhead ?? 7;
    const back = daysBack ?? 0;
    const events = await fetchEvents(gate.fetchJson, { daysAhead: ahead, daysBack: back });
    if (!events) return expired('Google Calendar');

    const window = back > 0 ? `the last ${back} and next ${ahead} days` : `the next ${ahead} days`;
    if (events.length === 0) {
      return `Nothing is on the user's primary calendar in ${window}.`;
    }

    return lines(
      `The user's primary calendar for ${window}, earliest first:`,
      events.map((event) => {
        const detail = [
          event.recurring ? 'recurring' : null,
          event.attendees.length ? `with ${event.attendees.join(', ')}` : null,
          event.location ? `at ${event.location}` : null,
        ].filter(Boolean).join(', ');
        const when = event.allDay ? `${event.start} (all day)` : shortTime(event.start);
        return `- ${when} — ${event.title}${detail ? ` (${detail})` : ''}`;
      }),
    );
  },

  listTasks: async ({ includeCompleted }) => {
    const gate = await ready('tasks', 'Google Tasks', tokens);
    if ('error' in gate) return gate.error;

    const tasks = await fetchTasks(gate.fetchJson, { includeCompleted });
    if (!tasks) return expired('Google Tasks');
    if (tasks.length === 0) {
      return includeCompleted
        ? 'The user has no tasks in Google Tasks.'
        : 'The user has no open tasks in Google Tasks.';
    }

    return lines(
      `The user's tasks, dated ones first:`,
      tasks.map((task) => {
        const parts = [
          task.due ? `due ${task.due}` : 'no due date',
          `list: ${task.list}`,
          task.completed ? 'done' : null,
        ].filter(Boolean);
        const notes = task.notes ? ` — notes: ${task.notes}` : '';
        return `- ${task.title} (${parts.join(', ')})${notes}`;
      }),
    );
  },

  listRecentEmails: async ({ search, limit }) => {
    const gate = await ready('gmail', 'Gmail', tokens);
    if ('error' in gate) return gate.error;

    const mail = await fetchMail(gate.fetchJson, { search, limit });
    if (!mail) return expired('Gmail');
    if (mail.length === 0) {
      return search
        ? `No recent email matches "${search}".`
        : 'No recent email in the last 60 days.';
    }

    return lines(
      `Recent email headers${search ? ` matching "${search}"` : ''} — subjects and senders only. Willow has metadata-only access to Gmail and cannot read message contents, so do not describe what any of these say.`,
      mail.map((message) => {
        const sender = message.domain ? `${message.from} (${message.domain})` : message.from;
        const when = message.date ? ` — ${shortMailDate(message.date)}` : '';
        return `- ${sender}: "${message.subject}"${when}${message.unread ? ' [unread]' : ''}`;
      }),
    );
  },

  listTopMusic: async ({ kind, timeRange, limit }) => {
    const gate = await ready('spotify', 'Spotify', tokens);
    if ('error' in gate) return gate.error;

    const range = asTimeRange(timeRange);
    const window = TIME_RANGE_LABELS[range];

    // Artists unless tracks were asked for. Artists are the better default: they
    // carry genres, so one call describes taste rather than listing twenty songs.
    if (kind === 'tracks') {
      const tracks = await fetchTopTracks(gate.fetchJson, { limit, timeRange: range });
      if (!tracks) return expired('Spotify');
      if (tracks.length === 0) {
        return `Spotify has no top tracks for the user over ${window}. This is usually a new or barely-used account rather than an error.`;
      }
      return lines(
        `The user's most-played Spotify tracks over ${window}, most played first:`,
        tracks.map((track) => `- "${track.title}" — ${track.artists}${track.album ? ` (${track.album})` : ''}`),
      );
    }

    const artists = await fetchTopArtists(gate.fetchJson, { limit, timeRange: range });
    if (!artists) return expired('Spotify');
    if (artists.length === 0) {
      return `Spotify has no top artists for the user over ${window}. This is usually a new or barely-used account rather than an error.`;
    }
    return lines(
      `The user's most-played Spotify artists over ${window}, most played first. The genres are Spotify's own labels:`,
      artists.map((artist) => {
        const genres = artist.genres.slice(0, 3).join(', ');
        return `- ${artist.name}${genres ? ` — ${genres}` : ''}`;
      }),
    );
  },

  listSavedTracks: async ({ limit }) => {
    const gate = await ready('spotify', 'Spotify', tokens);
    if ('error' in gate) return gate.error;

    const tracks = await fetchSavedTracks(gate.fetchJson, { limit });
    if (!tracks) return expired('Spotify');
    if (tracks.length === 0) return 'The user has no saved tracks in their Spotify library.';

    return lines(
      // Worth distinguishing for the model: saving is a decision, playing is a
      // habit, and "what do I like" is better answered by the first.
      `Tracks the user saved to their Spotify library, most recent first. Saved is deliberate, unlike most-played:`,
      tracks.map((track) => `- "${track.title}" — ${track.artists}${track.album ? ` (${track.album})` : ''}`),
    );
  },

  listSpotifyPlaylists: async ({ limit }) => {
    const gate = await ready('spotify', 'Spotify', tokens);
    if ('error' in gate) return gate.error;

    const playlists = await fetchPlaylists(gate.fetchJson, { limit });
    if (!playlists) return expired('Spotify');
    if (playlists.length === 0) return 'The user has no Spotify playlists.';

    return lines(
      'The user\'s Spotify playlists:',
      playlists.map((playlist) => `- ${playlist.name} (${playlist.tracks} tracks)`),
    );
  },

  listPullRequests: async ({ filter, limit }) => {
    const gate = await readyGithub(tokens);
    if ('error' in gate) return gate.error;

    // An unrecognised filter falls back rather than failing. A model that writes
    // "reviewer" or "mine" meant one of these, and the default covers all of them.
    const chosen: PullRequestFilter = isPullRequestFilter(filter) ? filter : 'involves';
    const label = PR_FILTER_LABELS[chosen];

    const items = await fetchPullRequests(gate.fetchJson, {
      login: gate.login,
      filter: chosen,
      limit,
    });
    if (!items) return expired('GitHub');
    if (items.length === 0) return `No open pull requests ${label}.`;

    return lines(
      `Open GitHub pull requests ${label}, most recently updated first. A draft is not ready for review yet:`,
      items.map(githubItemLine),
    );
  },

  listGithubIssues: async ({ limit }) => {
    const gate = await readyGithub(tokens);
    if ('error' in gate) return gate.error;

    const items = await fetchIssues(gate.fetchJson, { login: gate.login, limit });
    if (!items) return expired('GitHub');
    if (items.length === 0) return 'No open GitHub issues are assigned to the user.';

    return lines(
      'Open GitHub issues assigned to the user, most recently updated first:',
      items.map(githubItemLine),
    );
  },

  listGithubRepos: async ({ limit }) => {
    const gate = await readyGithub(tokens);
    if ('error' in gate) return gate.error;

    const repos = await fetchRepos(gate.fetchJson, { limit });
    if (!repos) return expired('GitHub');
    if (repos.length === 0) {
      // Almost always the token rather than the account: a fine-grained token sees
      // only the repositories it was given when it was made, and "all repositories"
      // is not the default on GitHub's form.
      return 'The access token the user pasted can see no GitHub repositories. A fine-grained token only covers the repositories selected when it was created, so this usually means none were selected rather than that the user has none.';
    }

    return lines(
      'GitHub repositories the user can access, most recently pushed first. Metadata only — no file contents, commits or diffs are available, so do not describe what any of this code does:',
      repos.map(githubRepoLine),
    );
  },
});
