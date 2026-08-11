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
import type { ConnectorDefinition, ConnectorId, ConnectorReader } from './types';

import { calendarConnector } from './google/calendar';
import { contactsConnector } from './google/contacts';
import { gmailConnector } from './google/gmail';
import { tasksConnector } from './google/tasks';
import { youtubeConnector } from './google/youtube';

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
    id: 'contacts',
    label: 'Google Contacts',
    description: 'Relationship labels you set yourself, such as partner or manager.',
    readScopes: SCOPES.contacts.read,
    writeScopes: SCOPES.contacts.write,
    providesSignals: true,
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
];

/** Readers, keyed by id. Only signal connectors appear here. */
export const READERS: Partial<Record<ConnectorId, ConnectorReader>> = {
  calendar: calendarConnector,
  gmail: gmailConnector,
  youtube: youtubeConnector,
  contacts: contactsConnector,
  tasks: tasksConnector,
};

export const connectorById = (id: ConnectorId): ConnectorDefinition | undefined =>
  CONNECTORS.find((connector) => connector.id === id);

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
 * The scopes needed to run an action tool.
 *
 * Write access is requested when a tool first needs it rather than at connect
 * time, so connecting Calendar to see your week does not also hand over the
 * ability to change it until you ask for something that requires that.
 */
export const writeScopesFor = (id: ConnectorId): string[] => scopeUrls([id], 'write');
