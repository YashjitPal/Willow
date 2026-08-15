/**
 * The scope table.
 *
 * One place to see exactly what each connector asks for, because "what did you
 * ask Google for" is a question the user is entitled to answer from this file
 * alone. Tiers follow Google's published classification: restricted scopes need
 * a verified app, sensitive ones need at least the consent screen, and basic
 * ones need nothing beyond a normal client. Things that have no API at all —
 * Google Search history, YouTube watch history — are deliberately absent.
 */

import type { ConnectorScope } from './types';

const gmailMetadata: ConnectorScope = {
  url: 'https://www.googleapis.com/auth/gmail.metadata',
  summary: 'Read email subjects, senders and labels',
  tier: 'restricted',
};

const calendarRead: ConnectorScope = {
  url: 'https://www.googleapis.com/auth/calendar.readonly',
  summary: 'Read your calendars and events',
  tier: 'sensitive',
};

const calendarWrite: ConnectorScope = {
  url: 'https://www.googleapis.com/auth/calendar.events',
  summary: 'Create and edit calendar events',
  tier: 'sensitive',
};

const youtubeRead: ConnectorScope = {
  url: 'https://www.googleapis.com/auth/youtube.readonly',
  summary: 'Read your liked videos, playlists and subscriptions',
  tier: 'sensitive',
};

const youtubeWrite: ConnectorScope = {
  url: 'https://www.googleapis.com/auth/youtube',
  summary: 'Create and edit playlists',
  tier: 'sensitive',
};

const tasksRead: ConnectorScope = {
  url: 'https://www.googleapis.com/auth/tasks.readonly',
  summary: 'Read your tasks and lists',
  tier: 'basic',
};

const tasksWrite: ConnectorScope = {
  url: 'https://www.googleapis.com/auth/tasks',
  summary: 'Create and edit tasks',
  tier: 'basic',
};

const driveRead: ConnectorScope = {
  url: 'https://www.googleapis.com/auth/drive.readonly',
  summary: 'See your Drive files and folders',
  tier: 'restricted',
};

/**
 * Google's recommended Drive scope, and the reason Drive needs no verification:
 * `drive.file` is non-sensitive because it grants nothing up front — access is
 * per-file, and only for files the user opened in Willow or Willow created. The
 * broad `drive.readonly` above is the restricted one.
 */
const driveFile: ConnectorScope = {
  url: 'https://www.googleapis.com/auth/drive.file',
  summary: 'Access files you open or create in Willow',
  tier: 'basic',
};

/**
 * Docs has no read scope distinct from Drive: a Docs file is a Drive file.
 *
 * Sensitive rather than restricted, per the Cloud console's own classification —
 * it needs the consent screen but not the verification a restricted scope drags
 * in. Only `gmail.metadata` and `drive.readonly` are restricted here.
 */
const docsWrite: ConnectorScope = {
  url: 'https://www.googleapis.com/auth/documents',
  summary: 'Create and edit documents',
  tier: 'sensitive',
};

/*
 * Spotify.
 *
 * Spotify publishes no tier system, so `tier` records the honest equivalent: none
 * of these carry a verification requirement, and the consent screen lists them
 * plainly. The interesting constraint is elsewhere and is not about scopes at all —
 * see `spotify/pkce-token-source.ts` on development mode.
 *
 * `user-top-read` is the one worth having. It is Spotify's own computed answer to
 * "what does this person actually listen to", over a choice of time ranges, and
 * there is no equivalent anywhere in Google's products — YouTube will not even say
 * what was watched. `user-library-read` adds what they deliberately saved, which is
 * a different and stronger signal than what they happened to play.
 */
const spotifyTopRead: ConnectorScope = {
  url: 'user-top-read',
  summary: 'Read your top artists and tracks',
  tier: 'basic',
};

const spotifyLibraryRead: ConnectorScope = {
  url: 'user-library-read',
  summary: 'Read the music you have saved',
  tier: 'basic',
};

const spotifyRecentRead: ConnectorScope = {
  url: 'user-read-recently-played',
  summary: 'Read what you played recently',
  tier: 'basic',
};

const spotifyPlaylistRead: ConnectorScope = {
  url: 'playlist-read-private',
  summary: 'Read your playlists, including private ones',
  tier: 'basic',
};

/**
 * Both playlist write scopes, because Spotify splits them by visibility and a
 * playlist Willow creates is private — `playlist-modify-public` alone would fail on
 * exactly the playlists this is meant to create.
 */
const spotifyPlaylistWrite: ConnectorScope[] = [
  {
    url: 'playlist-modify-private',
    summary: 'Create and edit your private playlists',
    tier: 'basic',
  },
  {
    url: 'playlist-modify-public',
    summary: 'Create and edit your public playlists',
    tier: 'basic',
  },
];

/*
 * GitHub.
 *
 * These are the only scopes in this file Willow never asks anyone for, and the
 * distinction matters enough to state twice. A fine-grained personal access token's
 * permissions are chosen by the user on GitHub's own website — there is no consent
 * screen Willow can put them on, because there is no OAuth flow a browser can complete
 * (see `github/pat-token-source.ts`). So these entries are a checklist the Settings
 * card shows while the user creates the token, not a request.
 *
 * They are still load-bearing rather than documentation: `refreshAuthorizations` treats
 * a connector with no read scopes as one that cannot be authorized, so an empty list
 * here would leave GitHub permanently expired.
 *
 * `url` therefore holds GitHub's own permission name as it appears in their UI, which is
 * what the user has to find and tick. Read-only throughout, and there is no write list
 * at all: Willow does not open pull requests or comment on issues, so it has no reason
 * to hold a token that could.
 */
const githubMetadata: ConnectorScope = {
  url: 'repository:metadata',
  summary: 'Repository metadata (GitHub requires this on every fine-grained token)',
  tier: 'basic',
};

const githubPullRequests: ConnectorScope = {
  url: 'repository:pull_requests:read',
  summary: 'Read pull requests, including ones waiting on your review',
  tier: 'basic',
};

const githubIssues: ConnectorScope = {
  url: 'repository:issues:read',
  summary: 'Read issues assigned to you',
  tier: 'basic',
};

export const SCOPES: Record<
  'gmail' | 'calendar' | 'youtube' | 'tasks' | 'drive' | 'docs' | 'spotify' | 'github',
  { read: ConnectorScope[]; write: ConnectorScope[] }
> = {
  gmail: { read: [gmailMetadata], write: [] },
  calendar: { read: [calendarRead], write: [calendarWrite] },
  youtube: { read: [youtubeRead], write: [youtubeWrite] },
  tasks: { read: [tasksRead], write: [tasksWrite] },
  drive: { read: [driveRead], write: [driveFile] },
  docs: { read: [], write: [docsWrite] },
  spotify: {
    read: [spotifyTopRead, spotifyLibraryRead, spotifyRecentRead, spotifyPlaylistRead],
    write: spotifyPlaylistWrite,
  },
  github: { read: [githubMetadata, githubPullRequests, githubIssues], write: [] },
};
