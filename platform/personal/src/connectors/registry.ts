/**
 * The connector registry.
 *
 * One table, and the only file the UI needs to render the Connected Apps list.
 * Adding a product means one file in `google/` and one entry here.
 *
 * `providesSignals` is the field that decides everything downstream. It marks the
 * products whose data may describe the user, and the ones marked false are not
 * "not implemented" — they are products deliberately never read for
 * personalization. Drive and Docs hold everything a person has ever written, and
 * a feature that quietly turned that into profile bullets would be doing
 * something no one asked it to do, no matter how good the bullets were.
 */

import { SCOPES } from './scopes';
import { tokenSource, type TokenSource } from './token-source';
import type {
  ConnectorDefinition,
  ConnectorId,
  ConnectorProvider,
  ConnectorReader,
} from './types';

import { calendarConnector } from './google/calendar';
import { gmailConnector } from './google/gmail';
import { tasksConnector } from './google/tasks';
import { youtubeConnector } from './google/youtube';
import { spotifyConnector } from './spotify/spotify';
import { githubConnector } from './github/github';

export const CONNECTORS: ConnectorDefinition[] = [
  {
    id: 'calendar',
    label: 'Google Calendar',
    description: 'Upcoming events, recurring commitments, and who you meet with.',
    readScopes: SCOPES.calendar.read,
    writeScopes: SCOPES.calendar.write,
    providesSignals: true,
  },
  {
    id: 'gmail',
    label: 'Gmail',
    description: 'Senders, subjects and labels — never message contents.',
    readScopes: SCOPES.gmail.read,
    writeScopes: SCOPES.gmail.write,
    providesSignals: true,
    caveat: 'Willow requests metadata-only access, so it cannot read your emails.',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    description: 'Liked videos and subscriptions, and creating playlists.',
    readScopes: SCOPES.youtube.read,
    writeScopes: SCOPES.youtube.write,
    providesSignals: true,
    caveat: 'Watch history has no API, so Willow can only see what you liked or subscribed to.',
  },
  {
    id: 'tasks',
    label: 'Google Tasks',
    description: 'Read what you have due, and add tasks on request.',
    readScopes: SCOPES.tasks.read,
    writeScopes: SCOPES.tasks.write,
    providesSignals: true,
  },
  {
    id: 'drive',
    label: 'Google Drive',
    description: 'Save files to your Drive. Willow only sees files it created.',
    readScopes: SCOPES.drive.read,
    writeScopes: SCOPES.drive.write,
    providesSignals: false,
  },
  {
    id: 'docs',
    label: 'Google Docs',
    description: 'Create and write documents on request.',
    readScopes: SCOPES.docs.read,
    writeScopes: SCOPES.docs.write,
    providesSignals: false,
  },
  {
    id: 'spotify',
    provider: 'spotify',
    label: 'Spotify',
    description: 'Your top artists and tracks, saved music, and creating playlists.',
    readScopes: SCOPES.spotify.read,
    writeScopes: SCOPES.spotify.write,
    providesSignals: true,
    caveat:
      'Spotify limits unreviewed apps to a list of named users, and the app owner needs Premium.',
  },
  {
    id: 'github',
    provider: 'github',
    label: 'GitHub',
    description: 'Pull requests waiting on you, issues assigned to you, and what you are working on.',
    readScopes: SCOPES.github.read,
    writeScopes: SCOPES.github.write,
    providesSignals: true,
    caveat:
      'GitHub cannot do browser sign-in, so this needs a read-only access token you create and paste. It is kept for this tab only, so you will paste it again next time.',
  },
];

/** Readers, keyed by id. Only signal connectors appear here. */
export const READERS: Partial<Record<ConnectorId, ConnectorReader>> = {
  calendar: calendarConnector,
  gmail: gmailConnector,
  youtube: youtubeConnector,
  tasks: tasksConnector,
  spotify: spotifyConnector,
  github: githubConnector,
};

export const connectorById = (id: ConnectorId): ConnectorDefinition | undefined =>
  CONNECTORS.find((connector) => connector.id === id);

/**
 * Which provider issues this connector's tokens. Google unless stated.
 *
 * The default is what keeps `provider` off six of the seven original entries: they
 * were all Google, they still are, and an explicit `provider: 'google'` on each
 * would be six lines of noise to make one new connector look symmetrical.
 */
export const providerOf = (id: ConnectorId): ConnectorProvider =>
  connectorById(id)?.provider ?? 'google';

/** The token source for whichever provider owns this connector. */
export const tokensFor = (id: ConnectorId): TokenSource => tokenSource(providerOf(id));

/**
 * Which HTTP statuses mean "this credential is finished", for this connector.
 *
 * A property of the provider rather than of the call site, which is why it lives here
 * next to `providerOf` instead of being passed in by each reader. Google and Spotify
 * both answer an under-scoped request with a 403, so taking that as auth loss is what
 * makes a half-granted consent screen visible instead of silent. GitHub spends 403 on
 * rate limiting — on the default, a burst of reads would throw away a working token and
 * send the user off to replace it.
 *
 * Everything that builds an authorized fetch reads it from here, so a fourth provider
 * gets this right in one place rather than in however many readers it has.
 */
export const authLossStatusesFor = (id: ConnectorId): number[] =>
  providerOf(id) === 'github' ? [401] : [401, 403];

/**
 * Whether asking this connector's provider for a token can show the user anything.
 *
 * Google and Spotify open a consent screen, so a request that comes back with nothing
 * means the user closed it or the browser blocked it. GitHub's `request` reads a token
 * they already pasted, so nothing coming back means there is nothing to read — a
 * different failure with a different fix. Telling someone their permission window was
 * blocked when no window exists sends them hunting for a popup blocker.
 */
export const promptsForConsent = (id: ConnectorId): boolean => providerOf(id) !== 'github';

/** Whether a product can describe the user at all, regardless of user settings. */
export const canProvideSignals = (id: ConnectorId): boolean =>
  Boolean(connectorById(id)?.providesSignals) && Boolean(READERS[id]);

/**
 * Scope URLs for a set of connectors.
 *
 * Combined into one list on purpose: asking for everything at once means one
 * Allow screen when the user connects several products, instead of one popup per
 * product, each of which they must accept before the next appears.
 */
export const scopeUrls = (ids: ConnectorId[], kind: 'read' | 'write'): string[] => {
  const urls = new Set<string>();
  for (const id of ids) {
    const definition = connectorById(id);
    if (!definition) continue;
    for (const scope of kind === 'read' ? definition.readScopes : definition.writeScopes) {
      urls.add(scope.url);
    }
  }
  return [...urls];
};

/**
 * The scopes a connector's read tools need.
 *
 * These are granted at connect time, unlike the write scopes below — connecting a
 * product is the user saying Willow may read it, so a read tool never needs to ask
 * for anything and never opens a popup.
 */
export const readScopesFor = (id: ConnectorId): string[] => scopeUrls([id], 'read');

/**
 * The scopes needed to run an action tool.
 *
 * Write access is requested when a tool first needs it rather than at connect
 * time, so connecting Calendar to see your week does not also hand over the
 * ability to change it until you ask for something that requires that.
 */
export const writeScopesFor = (id: ConnectorId): string[] => scopeUrls([id], 'write');
