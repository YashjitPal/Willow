/**
 * Triggers as data: reading the condition the bot asked for, when a time trigger fires next, and how a trigger
 * reads in a sentence — to the dot in its tools and context, and to the user in the profile and on its card.
 */
import { formatStamp } from '../memory/render';
import type { DotTrigger, DotTriggerEvery, DotTriggerNotify, DotTriggerWhen } from '../thread/thread-types';
import { nextLocalMinute, nextLocalTime, parseClock, parseWeekday, zonedParts, zonedToUtc } from '../tools/zoned-time';

/** Each run is a turn of the bot's model, so a schedule repeats no faster than this. */
export const MIN_EVERY_MINUTES = 5;
/** Someone else's page is looked at no more often than this, and by default hourly. */
export const MIN_PAGE_MINUTES = 15;
export const DEFAULT_PAGE_MINUTES = 60;
export const MAX_TRIGGERS = 24;
/** Ended triggers kept for the profile's record of what ran. */
export const KEEP_ENDED = 10;

const WORKDAYS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Schedule = Extract<DotTriggerWhen, { type: 'schedule' }>;

export const isTimeTrigger = (when: DotTriggerWhen): boolean => when.type === 'once' || when.type === 'schedule';

const clockOf = (when: Schedule) => parseClock(when.at ?? '09:00') ?? { hour: 9, minute: 0 };

const nextMonthDay = (after: number, day: number, clock: { hour: number; minute: number }, timeZone: string): number => {
  const start = zonedParts(after, timeZone);
  for (let offset = 0; offset < 14; offset += 1) {
    const index = start.month - 1 + offset;
    const year = start.year + Math.floor(index / 12);
    const month = (index % 12) + 1;
    // The 31st of a 30-day month is its last day.
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const candidate = zonedToUtc(year, month, Math.min(day, last), clock.hour, clock.minute, timeZone);
    if (candidate > after) return candidate;
  }
  return after + 31 * 86_400_000;
};

/** The next `month`/`day` at `clock` after `after`; a 29 February falls on the 28th in other years. */
const nextYearDay = (after: number, month: number, day: number, clock: { hour: number; minute: number }, timeZone: string): number => {
  const start = zonedParts(after, timeZone);
  for (let year = start.year; year <= start.year + 1; year += 1) {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const candidate = zonedToUtc(year, month, Math.min(day, last), clock.hour, clock.minute, timeZone);
    if (candidate > after) return candidate;
  }
  return after + 366 * 86_400_000;
};

/** When a schedule fires next after `after`. */
export const nextScheduleAt = (when: Schedule, after: number, timeZone: string): number => {
  switch (when.every) {
    case 'minutes':
      return after + Math.max(MIN_EVERY_MINUTES, when.interval ?? 30) * 60_000;
    case 'hours':
      return nextLocalMinute(after + (Math.max(1, when.interval ?? 1) - 1) * 3_600_000, when.minute ?? 0, timeZone);
    case 'day':
      return nextLocalTime(after, clockOf(when), timeZone);
    case 'weekday':
      return nextLocalTime(after, clockOf(when), timeZone, WORKDAYS);
    case 'week':
      return nextLocalTime(after, clockOf(when), timeZone, new Set(when.days?.length ? when.days : [1]));
    case 'month':
      return nextMonthDay(after, when.dayOfMonth ?? 1, clockOf(when), timeZone);
    case 'year':
      return nextYearDay(after, when.month ?? 1, when.dayOfMonth ?? 1, clockOf(when), timeZone);
  }
};

/** When a time trigger fires next after `after`, or undefined when it never will again. */
export const nextFireAt = (trigger: Pick<DotTrigger, 'when' | 'timeZone'>, after: number): number | undefined => {
  if (trigger.when.type === 'once') return trigger.when.at > after ? trigger.when.at : undefined;
  if (trigger.when.type === 'schedule') return nextScheduleAt(trigger.when, after, trigger.timeZone);
  return undefined;
};

/* ------------------------------------------------------------------------ */
/* Reading what the bot asked for                                            */
/* ------------------------------------------------------------------------ */

export type ParsedWhen = { when: DotTriggerWhen } | { error: string };

const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const num = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

const TYPE_ALIASES: Record<string, DotTriggerWhen['type']> = {
  once: 'once', at: 'once', time: 'once', reminder: 'once',
  schedule: 'schedule', every: 'schedule', recurring: 'schedule', repeat: 'schedule', heartbeat: 'schedule',
  email: 'email', gmail: 'email', mail: 'email',
  calendar: 'calendar', event: 'calendar', meeting: 'calendar',
  github: 'github', pull_request: 'github', pull_requests: 'github', issue: 'github', issues: 'github',
  spark_task: 'spark_task', spark: 'spark_task', task: 'spark_task',
  web_page: 'web_page', page: 'web_page', website: 'web_page', url: 'web_page',
  folder: 'folder', files: 'folder', file: 'folder',
  user_returns: 'user_returns', return: 'user_returns', returns: 'user_returns', back: 'user_returns',
  discord: 'discord', discord_message: 'discord', discord_mention: 'discord',
};

const EVERY_ALIASES: Record<string, DotTriggerEvery> = {
  minute: 'minutes', minutes: 'minutes',
  hour: 'hours', hours: 'hours', hourly: 'hours',
  day: 'day', days: 'day', daily: 'day',
  weekday: 'weekday', weekdays: 'weekday', workday: 'weekday', workdays: 'weekday',
  week: 'week', weeks: 'week', weekly: 'week',
  month: 'month', months: 'month', monthly: 'month',
  year: 'year', years: 'year', yearly: 'year', annual: 'year', annually: 'year',
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A month as 1–12, from its number or its name. */
const parseMonth = (value: unknown): number | null => {
  const asNumber = num(value);
  if (asNumber !== undefined) return asNumber >= 1 && asNumber <= 12 ? Math.round(asNumber) : null;
  const text = str(value)?.slice(0, 3).toLowerCase();
  const index = text ? MONTH_NAMES.findIndex((name) => name.toLowerCase() === text) : -1;
  return index >= 0 ? index + 1 : null;
};

/** A day of the year from `month` and `day_of_month`, or one `date`: "10-19", "19 Oct", "October 19". */
const parseYearDay = (raw: Record<string, unknown>): { month: number; day: number } | null => {
  const date = str(raw.date);
  if (date) {
    const numeric = /^(?:\d{4}-)?(\d{1,2})-(\d{1,2})$/.exec(date);
    const dayFirst = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)$/i.exec(date);
    const monthFirst = /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?$/i.exec(date);
    const month = numeric ? parseMonth(numeric[1]) : dayFirst ? parseMonth(dayFirst[2]) : monthFirst ? parseMonth(monthFirst[1]) : null;
    const day = Number(numeric?.[2] ?? dayFirst?.[1] ?? monthFirst?.[2]);
    return month && day >= 1 ? { month, day } : null;
  }
  const month = parseMonth(raw.month);
  const day = Math.round(num(raw.day_of_month) ?? num(raw.day) ?? NaN);
  return month && Number.isFinite(day) ? { month, day } : null;
};

/** `2026-10-08 09:00` or `2026-10-08T09:00` is the user's wall clock; anything with an offset or `Z` is an instant. */
export const parseInstant = (value: string, now: number, timeZone: string): number | null => {
  const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (local) return zonedToUtc(Number(local[1]), Number(local[2]), Number(local[3]), Number(local[4]), Number(local[5]), timeZone);
  const clock = parseClock(value);
  if (clock) return nextLocalTime(now, clock, timeZone);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** `2026-12-31` means the end of that day in the user's zone; anything else is read as `parseInstant` reads it. */
export const parseUntil = (value: string, now: number, timeZone: string): number | null => {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (day) return zonedToUtc(Number(day[1]), Number(day[2]), Number(day[3]), 23, 59, timeZone);
  return parseInstant(value, now, timeZone);
};

const parseSchedule = (raw: Record<string, unknown>): ParsedWhen => {
  const everyText = (str(raw.every) ?? '').toLowerCase();
  // "15 minutes", "2 hours": the interval written into `every`.
  const spelled = /^(\d+)\s*([a-z]+)$/.exec(everyText);
  const every = EVERY_ALIASES[spelled ? spelled[2]! : everyText];
  if (!every) return { error: '"every" must be one of minutes, hours, day, weekday, week, month or year.' };
  const interval = num(raw.interval) ?? (spelled ? Number(spelled[1]) : undefined);
  const at = str(raw.at) ?? str(raw.time);
  const needsClock = every === 'day' || every === 'weekday' || every === 'week' || every === 'month' || every === 'year';
  if (needsClock && (!at || !parseClock(at))) return { error: 'Give "at" as a local time like 08:30.' };
  if (every === 'minutes') {
    if (interval === undefined) return { error: 'Give "interval": how many minutes between runs.' };
    if (interval < MIN_EVERY_MINUTES) return { error: `A schedule runs at most every ${MIN_EVERY_MINUTES} minutes. To watch for something sooner, use an event trigger, or sleep.` };
    if (interval > 1_440) return { error: 'For more than a day between runs, use "day", "week" or "month".' };
    return { when: { type: 'schedule', every, interval: Math.round(interval) } };
  }
  if (every === 'hours') {
    const hours = Math.round(interval ?? 1);
    if (hours < 1 || hours > 24) return { error: '"interval" for hours must be between 1 and 24.' };
    const minute = Math.max(0, Math.min(59, Math.round(num(raw.minute) ?? 0)));
    return { when: { type: 'schedule', every, interval: hours, minute } };
  }
  if (every === 'week') {
    const list = Array.isArray(raw.days) ? raw.days : raw.days === undefined ? [] : [raw.days];
    const days = [...new Set(list.map(parseWeekday).filter((day): day is number => day !== null))].sort();
    if (!days.length) return { error: 'Give "days" for a weekly schedule, as weekday names.' };
    return { when: { type: 'schedule', every, at: at!, days } };
  }
  if (every === 'month') {
    const dayOfMonth = Math.round(num(raw.day_of_month) ?? num(raw.day) ?? 1);
    if (dayOfMonth < 1 || dayOfMonth > 31) return { error: '"day_of_month" must be between 1 and 31.' };
    return { when: { type: 'schedule', every, at: at!, dayOfMonth } };
  }
  if (every === 'year') {
    const date = parseYearDay(raw);
    if (!date) return { error: 'Give the day it falls on: "month" and "day_of_month", or "date" like 10-19.' };
    const last = new Date(Date.UTC(2024, date.month, 0)).getUTCDate();
    if (date.day > last) return { error: `${MONTH_NAMES[date.month - 1]} has no day ${date.day}.` };
    return { when: { type: 'schedule', every, at: at!, month: date.month, dayOfMonth: date.day } };
  }
  return { when: { type: 'schedule', every, at: at! } };
};

/**
 * Reads a trigger's condition from a tool call. Tolerates the spellings models reach for — a type named by alias, an
 * interval written into `every` — and answers anything it cannot read with a sentence saying what to send instead.
 */
export const parseWhen = (raw: unknown, now: number, timeZone: string): ParsedWhen => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Give "when" as an object with a "type".' };
  const spec = raw as Record<string, unknown>;
  const typeText = (str(spec.type) ?? (spec.every !== undefined ? 'schedule' : spec.at !== undefined ? 'once' : '')).toLowerCase().replace(/[\s-]+/g, '_');
  const type = TYPE_ALIASES[typeText];
  switch (type) {
    case 'once': {
      const minutes = num(spec.in_minutes);
      const atText = str(spec.at);
      const at = minutes !== undefined ? now + minutes * 60_000 : atText ? parseInstant(atText, now, timeZone) : null;
      if (at === null) return { error: 'Give "at" as a local date and time like 2026-10-08 09:00, or "in_minutes".' };
      if (at - now < 60_000) return { error: 'That time has passed or is less than a minute away. To act now, just act.' };
      if (at - now > 366 * 86_400_000) return { error: 'A one-off trigger can be at most a year away.' };
      return { when: { type: 'once', at } };
    }
    case 'schedule':
      // A heartbeat with no cadence of its own checks in hourly.
      return parseSchedule(typeText === 'heartbeat' && spec.every === undefined
        ? { ...spec, every: 'minutes', interval: spec.interval ?? spec.every_minutes ?? 60 }
        : spec);
    case 'email': {
      const query = str(spec.query) ?? str(spec.search) ?? str(spec.filter);
      if (!query) return { error: 'Give "query": the Gmail search new mail must match, in Gmail\'s search syntax.' };
      if (query.length > 300) return { error: 'Keep the email search under 300 characters.' };
      return { when: { type: 'email', query } };
    }
    case 'calendar': {
      const minutesBefore = Math.round(num(spec.minutes_before) ?? num(spec.minutes) ?? 10);
      if (minutesBefore < 0 || minutesBefore > 1_440) return { error: '"minutes_before" must be between 0 and 1440.' };
      const match = str(spec.match) ?? str(spec.title);
      return { when: { type: 'calendar', minutesBefore, ...(match ? { match } : {}) } };
    }
    case 'github': {
      const watchText = (str(spec.watch) ?? str(spec.what) ?? (typeText.startsWith('issue') ? 'issues' : 'pull_requests')).toLowerCase();
      const watch = watchText.startsWith('issue') ? 'issues' : watchText.startsWith('pull') || watchText === 'prs' || watchText === 'pr' ? 'pull_requests' : null;
      if (!watch) return { error: '"watch" must be pull_requests or issues.' };
      const repo = str(spec.repo) ?? str(spec.repository);
      if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) return { error: '"repo" must be written owner/name.' };
      const match = str(spec.match);
      return { when: { type: 'github', watch, ...(repo ? { repo } : {}), ...(match ? { match } : {}) } };
    }
    case 'spark_task': {
      const statusText = (str(spec.status) ?? 'complete').toLowerCase();
      const status = statusText.startsWith('fail') ? 'failed' : statusText.startsWith('need') || statusText === 'waiting' ? 'needs-input' : statusText === 'any' ? 'any' : statusText.startsWith('complet') || statusText === 'done' || statusText === 'finished' ? 'complete' : null;
      if (!status) return { error: '"status" must be complete, failed, needs-input or any.' };
      const match = str(spec.match) ?? str(spec.title);
      return { when: { type: 'spark_task', status, ...(match ? { match } : {}) } };
    }
    case 'web_page': {
      const url = str(spec.url);
      let parsed: URL | null = null;
      try {
        parsed = url ? new URL(url) : null;
      } catch {
        parsed = null;
      }
      if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) return { error: 'Give "url": the full http or https address of the page.' };
      const everyMinutes = Math.round(num(spec.every_minutes) ?? DEFAULT_PAGE_MINUTES);
      if (everyMinutes < MIN_PAGE_MINUTES) return { error: `Someone else's page is checked at most every ${MIN_PAGE_MINUTES} minutes.` };
      if (everyMinutes > 1_440) return { error: '"every_minutes" can be at most 1440 (once a day).' };
      const contains = str(spec.contains);
      return { when: { type: 'web_page', url: parsed.toString(), everyMinutes, ...(contains ? { contains } : {}) } };
    }
    case 'folder': {
      const path = str(spec.path)?.replace(/^[\\/]+/, '');
      if (path && /(^|[\\/])\.\.([\\/]|$)/.test(path)) return { error: '"path" must stay inside the connected folder.' };
      return { when: { type: 'folder', ...(path ? { path } : {}) } };
    }
    case 'user_returns': {
      const awayHours = num(spec.away_hours) ?? num(spec.hours) ?? 8;
      if (awayHours < 1 || awayHours > 720) return { error: '"away_hours" must be between 1 and 720.' };
      return { when: { type: 'user_returns', awayHours } };
    }
    case 'discord': {
      const channel = str(spec.channel)?.slice(0, 100);
      const server = (str(spec.server) ?? str(spec.guild))?.slice(0, 100);
      const from = (str(spec.from) ?? str(spec.author))?.slice(0, 100);
      const match = (str(spec.match) ?? str(spec.contains))?.slice(0, 200);
      const mentions = spec.mentions === true || spec.mentions === 'true' || typeText === 'discord_mention';
      if (!channel && !server && !from && !match && !mentions) {
        return { error: 'Narrow a Discord trigger to what the user named: a "channel", a "server", who it is "from", words to "match", or "mentions": true.' };
      }
      return { when: { type: 'discord', ...(channel ? { channel } : {}), ...(server ? { server } : {}), ...(from ? { from } : {}), ...(match ? { match } : {}), ...(mentions ? { mentions: true } : {}) } };
    }
    default:
      return { error: '"type" must be one of once, schedule, email, calendar, github, spark_task, web_page, folder, user_returns or discord.' };
  }
};

export const parseNotify = (value: unknown): DotTriggerNotify | null => {
  const text = (str(value) ?? 'important').toLowerCase();
  if (text === 'always' || text === 'every_time' || text === 'each') return 'always';
  if (text === 'never' || text === 'silent' || text === 'quiet' || text === 'none') return 'never';
  if (text === 'important' || text === 'when_it_matters' || text === 'matters' || text === 'auto') return 'important';
  return null;
};

/* ------------------------------------------------------------------------ */
/* In words                                                                  */
/* ------------------------------------------------------------------------ */

/** Whom a sentence is for: the bot reads about "the user", the user about "you". */
export type Audience = 'dot' | 'user';

const ordinal = (value: number) => {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  return `${value}${['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'}`;
};

const listDays = (days: number[]) => {
  const names = days.map((day) => DAY_NAMES[day] ?? '?');
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** A folder named in full — with the whole computer connected — rather than inside the connected folder. */
export const isFullPath = (path: string | undefined): boolean => Boolean(path && (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/')));

/** What makes a trigger fire, as a phrase: "Weekdays at 08:30", "When an email matching … arrives". */
export const describeWhen = (when: DotTriggerWhen, timeZone: string, audience: Audience = 'dot'): string => {
  const user = audience === 'dot' ? 'the user' : 'you';
  switch (when.type) {
    case 'once':
      return `Once, ${formatStamp(when.at, timeZone)}`;
    case 'schedule':
      switch (when.every) {
        case 'minutes':
          return `Every ${plural(when.interval ?? 30, 'minute')}`;
        case 'hours':
          return (when.interval ?? 1) === 1 ? `Every hour at :${String(when.minute ?? 0).padStart(2, '0')}` : `Every ${when.interval} hours`;
        case 'day':
          return `Every day at ${when.at}`;
        case 'weekday':
          return `Weekdays at ${when.at}`;
        case 'week':
          return `Every ${listDays(when.days ?? [1])} at ${when.at}`;
        case 'month':
          return `On the ${ordinal(when.dayOfMonth ?? 1)} of each month at ${when.at}`;
        case 'year':
          return `Every year on ${when.dayOfMonth ?? 1} ${MONTH_NAMES[(when.month ?? 1) - 1]} at ${when.at}`;
      }
      return 'On a schedule';
    case 'email':
      return `When an email matching “${when.query}” arrives`;
    case 'calendar':
      return `${when.minutesBefore === 0 ? 'When' : `${plural(when.minutesBefore, 'minute')} before`} each calendar event${when.match ? ` titled “${when.match}”` : ''}${when.minutesBefore === 0 ? ' starts' : ''}`;
    case 'github':
      return `When a GitHub ${when.watch === 'issues' ? `issue assigned to ${user}` : `pull request involving ${user}`} is opened or updated${when.repo ? ` in ${when.repo}` : ''}${when.match ? ` matching “${when.match}”` : ''}`;
    case 'spark_task': {
      const what = when.status === 'complete' ? 'finishes' : when.status === 'failed' ? 'fails' : when.status === 'needs-input' ? 'needs input' : 'changes state';
      return `When a Spark task${when.match ? ` titled “${when.match}”` : ''} ${what}`;
    }
    case 'web_page': {
      const every = when.everyMinutes % 60 === 0 ? (when.everyMinutes === 60 ? 'hourly' : `every ${plural(when.everyMinutes / 60, 'hour')}`) : `every ${plural(when.everyMinutes, 'minute')}`;
      return `${when.contains ? `When ${when.url} shows “${when.contains}”` : `When ${when.url} changes`}, checked ${every}`;
    }
    case 'folder':
      return isFullPath(when.path) ? `When files change in ${when.path}` : `When files change in ${when.path ? `${when.path} in ` : ''}the connected folder`;
    case 'user_returns':
      return `When ${user} come${audience === 'dot' ? 's' : ''} back to Willow after ${plural(when.awayHours, 'hour')} away`;
    case 'discord': {
      const wanted = when.channel?.replace(/^#/, '');
      const channel = !wanted ? '' : /^(dm|dms|direct)$/i.test(wanted) ? ' in a DM' : /^\d+$/.test(wanted) ? ` in channel ${wanted}` : ` in #${wanted}`;
      const what = when.mentions ? `a Discord message mentions ${audience === 'dot' ? 'you' : 'the bot'}` : 'a Discord message arrives';
      return `When ${what}${channel}${when.server ? ` in ${when.server}` : ''}${when.from ? ` from ${when.from}` : ''}${when.match ? ` containing “${when.match}”` : ''}`;
    }
  }
};

const NOTIFY_WORDS: Record<DotTriggerNotify, Record<Audience, string>> = {
  always: { dot: 'tell the user about every run', user: 'Tells you every time' },
  important: { dot: 'tell the user only when a run finds something that matters', user: 'Tells you when it matters' },
  never: { dot: 'do not message the user about runs unless something is urgent', user: 'Works quietly' },
};

export const describeNotify = (notify: DotTriggerNotify, audience: Audience): string => NOTIFY_WORDS[notify][audience];

/** One line for the dot: id, name, condition, state, what it does — the instruction cut to `instructionChars`. */
export const describeTrigger = (trigger: DotTrigger, instructionChars = Infinity): string => {
  const tz = trigger.timeZone;
  const state = trigger.status === 'paused'
    ? 'paused'
    : trigger.status === 'ended'
      ? `ended${trigger.endedBecause ? ` (${trigger.endedBecause})` : ''}`
      : isTimeTrigger(trigger.when) && trigger.nextAt
        ? `next ${formatStamp(trigger.nextAt, tz)}`
        : 'watching';
  const limits = [
    trigger.until ? `until ${formatStamp(trigger.until, tz)}` : null,
    trigger.maxRuns ? `at most ${plural(trigger.maxRuns, 'run')}` : null,
  ].filter(Boolean).join(', ');
  const ran = trigger.runs ? `, ran ${plural(trigger.runs, 'time')}${trigger.lastRunAt ? `, last ${formatStamp(trigger.lastRunAt, tz)}` : ''}` : '';
  const screened = trigger.screened ? `, ${trigger.screened} screened out` : '';
  const problem = trigger.problem ? ` Problem: ${trigger.problem}` : '';
  const instruction = trigger.instruction.length > instructionChars ? `${trigger.instruction.slice(0, instructionChars - 1).trimEnd()}…` : trigger.instruction;
  const condition = trigger.condition ? `; only when: ${trigger.condition}` : '';
  return `${trigger.id} “${trigger.name}”: ${trigger.heartbeat ? 'Heartbeat, ' : ''}${describeWhen(trigger.when, tz)} (${tz})${condition}; ${state}${limits ? `; ${limits}` : ''}; ${describeNotify(trigger.notify, 'dot')}${ran}${screened}. Does: ${instruction}${problem}`;
};
