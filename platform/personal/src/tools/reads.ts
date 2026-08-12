/**
 * The real `PersonalReads`, wired to Google.
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

import { isConnected } from '../connectors/connections-store';
import { createGoogleFetch } from '../connectors/google-fetch';
import { readScopesFor } from '../connectors/registry';
import { tokenSource, type TokenSource } from '../connectors/token-source';
import type { ConnectorFetch, ConnectorId } from '../connectors/types';
import { listLabelledRelations as fetchRelations } from '../connectors/google/contacts';
import { listScheduledEvents as fetchEvents } from '../connectors/google/calendar';
import { listOpenTasks as fetchTasks } from '../connectors/google/tasks';
import { listRecentMail as fetchMail } from '../connectors/google/gmail';
import {
  listLikedVideos as fetchLikedVideos,
  listSubscriptions as fetchSubscriptions,
} from '../connectors/google/youtube';
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
const ready = async (id: ConnectorId, label: string, tokens: TokenSource): Promise<Ready> => {
  if (!profileStore.get().enabled) return { error: SWITCHED_OFF };
  if (!isConnected(id)) return { error: notConnected(label) };
  const scopes = readScopesFor(id);
  if (scopes.length === 0) return { error: notConnected(label) };
  const token = await tokens.get(scopes);
  if (!token) return { error: expired(label) };
  return { fetchJson: createGoogleFetch({ tokens, scopes }) };
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

export const createPersonalReads = (
  tokens: TokenSource = tokenSource(),
): PersonalReads => ({
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

  listRelationships: async () => {
    const gate = await ready('contacts', 'Google Contacts', tokens);
    if ('error' in gate) return gate.error;

    const relations = await fetchRelations(gate.fetchJson);
    if (!relations) return expired('Google Contacts');
    if (relations.length === 0) {
      return 'No contact in the user\'s Google Contacts carries a relationship label, so there is nothing to report. Their address book may still have plenty of people in it — Willow only reads the labels.';
    }

    return lines(
      'People the user labelled with a relationship in Google Contacts:',
      relations.map((entry) => `- ${entry.name} — ${entry.relation}`),
    );
  },
});
