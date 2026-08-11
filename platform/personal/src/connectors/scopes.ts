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

const contactsRead: ConnectorScope = {
  url: 'https://www.googleapis.com/auth/contacts.readonly',
  summary: 'Read your contacts',
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

export const SCOPES: Record<
  'gmail' | 'calendar' | 'youtube' | 'contacts' | 'tasks' | 'drive' | 'docs',
  { read: ConnectorScope[]; write: ConnectorScope[] }
> = {
  gmail: { read: [gmailMetadata], write: [] },
  calendar: { read: [calendarRead], write: [calendarWrite] },
  youtube: { read: [youtubeRead], write: [youtubeWrite] },
  contacts: { read: [contactsRead], write: [] },
  tasks: { read: [tasksRead], write: [tasksWrite] },
  drive: { read: [driveRead], write: [driveFile] },
  docs: { read: [], write: [docsWrite] },
};
