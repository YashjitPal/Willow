/**
 * Google Calendar.
 *
 * The most useful connector for personalization and the least interesting to
 * read, because a calendar is already the structured form of "what is happening
 * in this person's life at a particular time". It maps almost directly onto the
 * profile's dated-events section.
 *
 * Only a narrow window is read: a fortnight back and six weeks forward. Not a
 * quota concern — it is that a profile is a description of someone's life *now*,
 * and a bullet about a meeting in November read in August is noise that occupies
 * a capped slot a real upcoming commitment should have.
 */

import { paginate, query } from '../google-fetch';
import type { ConnectorFetch, ConnectorReader, ConnectorSignal } from '../types';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

const DAY_MS = 24 * 60 * 60 * 1000;
const LOOK_BACK_DAYS = 14;
const LOOK_AHEAD_DAYS = 42;

/** Events per page; two pages is plenty for a two-month window. */
const PAGE_SIZE = 100;
const MAX_PAGES = 2;

interface CalendarEvent {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: { email?: string; displayName?: string; self?: boolean; responseStatus?: string }[];
  recurringEventId?: string;
  eventType?: string;
}

const dateOf = (event: CalendarEvent): string | undefined => {
  const raw = event.start?.date ?? event.start?.dateTime;
  if (!raw) return undefined;
  const day = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
};

/**
 * Events not worth a profile bullet.
 *
 * Declined events are things the user is explicitly not doing. Cancelled ones
 * are gone. Birthdays and holidays come from generated calendars and would fill
 * the section with the same entries every year. Recurring instances are dropped
 * beyond their first occurrence by the dedupe below — a daily standup is one fact
 * about someone's week, not forty.
 */
const isNoise = (event: CalendarEvent): boolean => {
  if (event.status === 'cancelled') return true;
  if (event.eventType === 'birthday' || event.eventType === 'fromGmail') return true;
  const self = event.attendees?.find((attendee) => attendee.self);
  if (self?.responseStatus === 'declined') return true;
  const title = (event.summary ?? '').trim();
  if (!title) return true;
  return false;
};

/**
 * Who else was there, when that is a small enough number to mean something.
 *
 * A two-person meeting names a working relationship. A forty-person invite names
 * a mailing list. The cutoff keeps the first and discards the second, and only
 * display names are used — an email address in a stored profile is contact data
 * the user did not ask Willow to write down.
 */
const namedAttendees = (event: CalendarEvent): string[] => {
  const others = (event.attendees ?? []).filter((attendee) => !attendee.self);
  if (others.length === 0 || others.length > 4) return [];
  return others
    .map((attendee) => (attendee.displayName ?? '').trim())
    .filter((name) => name.length > 0);
};

export const readCalendarSignals = async (
  fetchJson: ConnectorFetch,
  signal?: AbortSignal,
): Promise<ConnectorSignal[]> => {
  const now = Date.now();
  const timeMin = new Date(now - LOOK_BACK_DAYS * DAY_MS).toISOString();
  const timeMax = new Date(now + LOOK_AHEAD_DAYS * DAY_MS).toISOString();

  const events = await paginate<CalendarEvent>(async (pageToken) => {
    const url = `${CALENDAR_API}/calendars/primary/events${query({
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: PAGE_SIZE,
      pageToken,
    })}`;
    const page = await fetchJson<{ items?: CalendarEvent[]; nextPageToken?: string }>(url, { signal });
    if (!page) return null;
    return { items: page.items ?? [], nextPageToken: page.nextPageToken };
  }, MAX_PAGES);

  const signals: ConnectorSignal[] = [];
  const seenTitles = new Set<string>();

  for (const event of events) {
    if (isNoise(event)) continue;
    const title = (event.summary ?? '').trim();
    const key = title.toLowerCase();
    // One bullet per distinct title: a recurring meeting is one fact.
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);

    const date = dateOf(event);
    const people = namedAttendees(event);
    const location = (event.location ?? '').trim();
    const recurring = Boolean(event.recurringEventId);

    const detail = [
      recurring ? 'a recurring commitment' : null,
      people.length ? `with ${people.join(', ')}` : null,
      location && location.length < 80 ? `at ${location}` : null,
    ].filter(Boolean).join(', ');

    signals.push({
      section: recurring ? 'demographics' : 'events',
      text: recurring
        ? `Has a recurring calendar commitment: ${title}`
        : `Has "${title}" on their calendar${date ? ` on ${date}` : ''}`,
      source: 'Google Calendar',
      evidence: `Calendar event "${title}"${detail ? ` — ${detail}` : ''}.`,
      ...(date ? { date } : {}),
    });
  }

  return signals;
};

export const calendarConnector: ConnectorReader = {
  id: 'calendar',
  readSignals: readCalendarSignals,
};
