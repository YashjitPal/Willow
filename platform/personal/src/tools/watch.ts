/**
 * Structured reads for work that runs by itself: a bot's triggers watching for new mail, coming events and
 * GitHub activity.
 *
 * The live reads' rules hold unchanged (reads.ts): Personal Intelligence on, the product connected, and a token
 * already held — `tokens.get`, never `tokens.request`. A background look is not a user gesture, so it never opens
 * a sign-in; an expired token is reported and the trigger waits, the way a profile build sits a connector out.
 *
 * Problems come back as short sentences for the user, because a trigger shows its problem in the bot's profile —
 * unlike the live reads, whose failures are written for the model.
 */

import { authLossHandler, markAuthorized, markExpired } from '../connectors/authorization';
import { createAuthorizedFetch } from '../connectors/authorized-fetch';
import { isConnected } from '../connectors/connections-store';
import { readGithubLogin } from '../connectors/github/session-store';
import { listAssignedIssues, listPullRequests, type GithubItem } from '../connectors/github/github';
import { listScheduledEvents, type ScheduledEvent } from '../connectors/google/calendar';
import {
  canReadContents,
  canSearch,
  listMailIds,
  mailMatches,
  parseMailSearch,
  readMail,
  readMailMessage,
  type MailHeader,
} from '../connectors/google/gmail';
import { authLossStatusesFor, readScopesFor, tokensFor } from '../connectors/registry';
import type { ConnectorFetch, ConnectorId } from '../connectors/types';
import { profileStore } from '../profile/profile-store';

export type Watched<T> = { items: T[] } | { problem: string };

const LABELS: Partial<Record<ConnectorId, string>> = { gmail: 'Gmail', calendar: 'Google Calendar', github: 'GitHub' };

/** Which products a trigger can watch right now, without asking the user for anything. */
export const watchableApps = (): { gmail: boolean; calendar: boolean; github: boolean } => {
  const on = profileStore.get().enabled;
  return { gmail: on && isConnected('gmail'), calendar: on && isConnected('calendar'), github: on && isConnected('github') };
};

const gate = async (id: ConnectorId): Promise<{ fetchJson: ConnectorFetch } | { problem: string }> => {
  const label = LABELS[id] ?? id;
  if (!profileStore.get().enabled) return { problem: 'Personal Intelligence is off, so Willow cannot look at your connected apps.' };
  if (!isConnected(id)) return { problem: `${label} is not connected. Connect it in Settings → Connected Apps.` };
  const scopes = readScopesFor(id);
  const tokens = tokensFor(id);
  const token = scopes.length ? await tokens.get(scopes) : null;
  if (!token) {
    markExpired(id);
    return { problem: `Willow's access to ${label} has expired. Reconnect it in Settings → Connected Apps.` };
  }
  markAuthorized(id);
  return { fetchJson: createAuthorizedFetch({ tokens, scopes, authLossStatuses: authLossStatusesFor(id), onAuthLost: authLossHandler(id) }) };
};

const failed = (id: ConnectorId) => ({ problem: `${LABELS[id] ?? id} could not be read just now; Willow will try again.` });

export interface WatchedMail extends MailHeader {
  /** With email contents: the sender's address, and the start of what the message says. */
  address?: string;
  excerpt?: string;
}

export interface WatchedMailLook {
  /** The messages to remember as seen. */
  ids: string[];
  /** New matches read this look, newest first. */
  fresh: WatchedMail[];
  /** New matches found but left unread this look. */
  more: number;
  /** Whether `fresh` carries what messages say. */
  contents: boolean;
}

/** Most messages read in one look; anything beyond waits for the next. */
const MAX_NEW_READS = 6;
const WATCH_WINDOW_MS = 2 * 86_400_000;
const EXCERPT_CHARS = 1_200;

/** The start of a message's own words: quoted history cut, whitespace folded. */
export const mailExcerpt = (body: string, max = EXCERPT_CHARS): string => {
  const own = body.split(/\n(?:On .{4,200}wrote:|-{2,} ?Original Message ?-{2,}|From: .+\nSent: )/)[0] ?? body;
  const text = own.split('\n').filter((line) => !line.startsWith('>')).join('\n').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

/**
 * New mail matching `search` from the last two days, newest first.
 *
 * With email contents Gmail's search does the matching, and every match counts as seen: the ones not read this
 * look are reported as `more`. Without them Willow reads the newest headers and filters them itself, so a message
 * counts as seen only once it has been read — one left for the next look is not lost.
 */
export const watchMail = async (
  search: string,
  known: (id: string) => boolean,
  signal?: AbortSignal,
): Promise<WatchedMailLook | { problem: string }> => {
  const ready = await gate('gmail');
  if ('problem' in ready) return ready;
  const contents = canSearch() && canReadContents();
  const ids = await listMailIds(ready.fetchJson, { search: contents ? `${search} newer_than:2d` : '', limit: contents ? 15 : 25, signal });
  if (!ids) return failed('gmail');
  const filter = contents ? null : parseMailSearch(search);
  const unseen = ids.filter((id) => !known(id));
  const read = new Set<string>();
  const fresh: WatchedMail[] = [];
  for (const id of unseen.slice(0, MAX_NEW_READS)) {
    if (signal?.aborted) break;
    if (contents) {
      const message = await readMailMessage(ready.fetchJson, id, { signal });
      if (!message) continue;
      read.add(id);
      const { id: messageId, from, domain, subject, date, unread } = message;
      fresh.push({ id: messageId, from, domain, subject, date, unread, address: message.address, excerpt: mailExcerpt(message.body) });
      continue;
    }
    const mail = await readMail(ready.fetchJson, id, { signal });
    if (!mail) continue;
    read.add(id);
    if (Date.now() - mail.facts.at > WATCH_WINDOW_MS || (filter && !mailMatches(mail.facts, filter))) continue;
    fresh.push(mail.header);
  }
  return {
    ids: ids.filter((id) => contents || known(id) || read.has(id)),
    fresh,
    more: contents ? unseen.filter((id) => !read.has(id)).length : 0,
    contents,
  };
};

/** Events on the primary calendar from now to `hoursAhead` from now, earliest first. */
export const watchCalendar = async (hoursAhead: number, signal?: AbortSignal): Promise<Watched<ScheduledEvent>> => {
  const ready = await gate('calendar');
  if ('problem' in ready) return ready;
  const events = await listScheduledEvents(ready.fetchJson, { daysAhead: Math.max(1, Math.ceil(hoursAhead / 24)), daysBack: 0, signal });
  if (!events) return failed('calendar');
  return { items: events };
};

/** Open pull requests involving the user, or open issues assigned to them, most recently updated first. */
export const watchGithub = async (watch: 'pull_requests' | 'issues', signal?: AbortSignal): Promise<Watched<GithubItem>> => {
  const ready = await gate('github');
  if ('problem' in ready) return ready;
  const login = readGithubLogin();
  if (!login) return { problem: "Willow's access to GitHub has expired. Reconnect it in Settings → Connected Apps." };
  const items = watch === 'issues'
    ? await listAssignedIssues(ready.fetchJson, { login, limit: 30, signal })
    : await listPullRequests(ready.fetchJson, { login, filter: 'involves', limit: 30, signal });
  if (!items) return failed('github');
  return { items };
};
