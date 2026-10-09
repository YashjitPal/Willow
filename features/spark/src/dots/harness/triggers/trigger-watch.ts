/**
 * Looking at what a bot's event triggers watch — new mail, coming events, GitHub activity, a page, a folder, Spark
 * tasks, the user's return — and saying what is new since the last look.
 *
 * A look compares the present with what the trigger saw last, stores the present, and reports only the difference.
 * The first look of a trigger records the present and reports nothing, so a trigger made today never fires for
 * yesterday's mail. A look that fails stores a problem in a sentence for the user and tries again later.
 */
import type { Watched, WatchedMail, WatchedMailLook } from '@willow/personal';
import { formatAgo } from '../memory/render';
import type { DotTrigger, DotTriggerWhen } from '../thread/thread-types';
import { isFullPath } from './trigger-spec';
import { rememberSeen } from './trigger-store';

/** A pull request or issue as the GitHub watcher reports it. */
export interface GithubItem {
  number: number;
  title: string;
  url: string;
  repo: string;
  author: string;
  updated: string;
  draft: boolean;
}

/** A calendar event as the calendar watcher reports it. */
export interface WatchedEvent {
  title: string;
  start: string;
  allDay: boolean;
  location?: string;
  attendees: string[];
}

export interface WatchedFile {
  path: string;
  type: 'file' | 'dir';
  size?: number;
  modifiedAt?: number;
}

/** Where looks get what they look at. The runtime wires Willow's connectors, its fetch endpoint and the companion. */
export interface TriggerSources {
  mail: (search: string, known: (id: string) => boolean) => Promise<WatchedMailLook | { problem: string }>;
  calendar: (hoursAhead: number) => Promise<Watched<WatchedEvent>>;
  github: (watch: 'pull_requests' | 'issues') => Promise<Watched<GithubItem>>;
  page: (url: string) => Promise<{ text: string; title?: string } | { problem: string }>;
  folder: (root: string, path: string) => Promise<{ entries: WatchedFile[]; truncated: boolean } | { problem: string }>;
}

export interface LookResult {
  /** What happened, for the bot, when something new fires the trigger. */
  fired?: string;
  /** Bookkeeping stored after the look, whether or not it fired. */
  patch: Partial<DotTrigger>;
}

const MINUTE = 60_000;
const LOOK_EVERY: Partial<Record<DotTriggerWhen['type'], number>> = {
  email: 3 * MINUTE,
  calendar: 10 * MINUTE,
  github: 5 * MINUTE,
  folder: 2 * MINUTE,
};
/** After a failed look, the next waits at least this long. */
const BACKOFF_MS = 15 * MINUTE;

/** How long a trigger waits between looks. */
export const lookInterval = (when: DotTriggerWhen): number => (when.type === 'web_page' ? when.everyMinutes * MINUTE : LOOK_EVERY[when.type] ?? 5 * MINUTE);

/** Whether a trigger is one the runtime looks for on a timer (the rest fire on time, or on something it hears). */
export const isPolled = (when: DotTriggerWhen): boolean => when.type === 'email' || when.type === 'calendar' || when.type === 'github' || when.type === 'web_page' || when.type === 'folder';

const failed = (problem: string, now: number, when: DotTriggerWhen): LookResult => ({
  patch: { problem, nextAt: now + Math.max(BACKOFF_MS, lookInterval(when)) },
});

const includes = (text: string, needle?: string) => !needle || text.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

/** FNV-1a, for remembering lines of a page without keeping the page. */
export const hashText = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
};

/** A page's text as lines worth comparing: trimmed, deduplicated, long enough to mean something. */
export const pageLines = (text: string): string[] => {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\n+/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (line.length < 16 || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
    if (lines.length >= 600) break;
  }
  return lines;
};

const lookAtMail = async (trigger: DotTrigger, when: Extract<DotTriggerWhen, { type: 'email' }>, sources: TriggerSources, now: number): Promise<LookResult> => {
  const known = new Set(trigger.seen ?? []);
  // Unprimed, everything counts as known: the look only learns which mail is already there.
  const result = await sources.mail(when.query, (id) => !trigger.primed || known.has(id));
  if ('problem' in result) return failed(result.problem, now, when);
  const patch: Partial<DotTrigger> = { seen: rememberSeen(trigger.seen, result.ids), primed: true, problem: undefined, nextAt: now + lookInterval(when) };
  if (!trigger.primed) return { patch };
  const count = result.fresh.length + result.more;
  if (count === 0) return { patch };
  const more = result.more ? `\n(and ${result.more} more)` : '';
  return {
    patch,
    fired: `${count === 1 ? 'A new email matches' : `${count} new emails match`} “${when.query}”:\n${result.fresh.map(describeMail).join('\n')}${more}\n${
      result.contents ? 'Read a whole message with read_email and its id.' : 'Willow sees senders and subjects only, never what a message says.'
    }`,
  };
};

const describeMail = (mail: WatchedMail): string => {
  const sender = mail.address ? `${mail.from} <${mail.address}>` : `${mail.from}${mail.domain ? ` (${mail.domain})` : ''}`;
  const head = `- ${sender}: “${mail.subject}”${mail.date ? ` — ${mail.date}` : ''} [id ${mail.id}]`;
  return mail.excerpt ? `${head}\n  ${mail.excerpt}` : head;
};

const clock = (at: number, timeZone: string) => {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(at));
  } catch {
    return new Date(at).toISOString().slice(11, 16);
  }
};

const lookAtCalendar = async (trigger: DotTrigger, when: Extract<DotTriggerWhen, { type: 'calendar' }>, sources: TriggerSources, now: number): Promise<LookResult> => {
  const result = await sources.calendar(24);
  if ('problem' in result) return failed(result.problem, now, when);
  const lead = when.minutesBefore * MINUTE;
  const seen = new Set(trigger.seen ?? []);
  const coming = result.items
    .filter((event) => !event.allDay && includes(event.title, when.match))
    .map((event) => ({ event, start: Date.parse(event.start), key: `${event.title}|${event.start}` }))
    .filter((entry) => Number.isFinite(entry.start) && entry.start > now - MINUTE);
  const due = coming.filter((entry) => entry.start - lead <= now && !seen.has(entry.key));
  // The next look lands when the soonest reminder is due, or at the usual interval, whichever is first.
  const soonest = Math.min(...coming.map((entry) => entry.start - lead).filter((at) => at > now), now + lookInterval(when));
  const patch: Partial<DotTrigger> = {
    seen: rememberSeen(trigger.seen, due.map((entry) => entry.key)),
    primed: true,
    problem: undefined,
    nextAt: Math.max(now + 30_000, soonest),
  };
  if (due.length === 0) return { patch };
  const lines = due.map(({ event, start }) => {
    const minutes = Math.round((start - now) / MINUTE);
    const detail = [event.location ? `at ${event.location}` : null, event.attendees.length ? `with ${event.attendees.slice(0, 6).join(', ')}` : null].filter(Boolean).join(', ');
    return `- “${event.title}” starts at ${clock(start, trigger.timeZone)} (${minutes <= 0 ? 'now' : `in ${plural(minutes, 'minute')}`})${detail ? `, ${detail}` : ''}.`;
  });
  return { patch, fired: `${due.length === 1 ? 'A calendar event is coming up' : `${due.length} calendar events are coming up`}:\n${lines.join('\n')}` };
};

const lookAtGithub = async (trigger: DotTrigger, when: Extract<DotTriggerWhen, { type: 'github' }>, sources: TriggerSources, now: number): Promise<LookResult> => {
  const result = await sources.github(when.watch);
  if ('problem' in result) return failed(result.problem, now, when);
  const items = result.items.filter((item) => (!when.repo || item.repo.toLowerCase() === when.repo.toLowerCase()) && includes(item.title, when.match));
  const keyOf = (item: GithubItem) => `${item.repo}#${item.number}@${item.updated}`;
  const known = new Set(trigger.seen ?? []);
  const patch: Partial<DotTrigger> = { seen: rememberSeen(trigger.seen, items.map(keyOf)), primed: true, problem: undefined, nextAt: now + lookInterval(when) };
  if (!trigger.primed) return { patch };
  const fresh = items.filter((item) => !known.has(keyOf(item)));
  if (fresh.length === 0) return { patch };
  const noun = when.watch === 'issues' ? 'issue' : 'pull request';
  const lines = fresh.slice(0, 10).map((item) => `- ${item.repo}#${item.number} “${item.title}”${item.draft ? ' [draft]' : ''}${item.author ? ` by ${item.author}` : ''}${item.updated ? `, updated ${item.updated.replace('T', ' ').slice(0, 16)}` : ''}${item.url ? ` ${item.url}` : ''}`);
  return { patch, fired: `${plural(fresh.length, `GitHub ${noun}`)} opened or updated:\n${lines.join('\n')}${fresh.length > 10 ? `\n(and ${fresh.length - 10} more)` : ''}` };
};

const lookAtPage = async (trigger: DotTrigger, when: Extract<DotTriggerWhen, { type: 'web_page' }>, sources: TriggerSources, now: number): Promise<LookResult> => {
  const result = await sources.page(when.url);
  if ('problem' in result) return failed(result.problem, now, when);
  const lines = pageLines(result.text);
  const hashes = lines.map(hashText);
  const flat = result.text.replace(/\s+/g, ' ');
  const contained = when.contains ? includes(flat, when.contains) : undefined;
  const patch: Partial<DotTrigger> = { seen: hashes, fingerprint: hashText(lines.join('\n')), contained, primed: true, problem: undefined, nextAt: now + lookInterval(when) };
  if (!trigger.primed) return { patch };
  const title = result.title ? ` (“${result.title}”)` : '';
  if (when.contains) {
    if (!contained || trigger.contained) return { patch };
    const at = flat.toLocaleLowerCase().indexOf(when.contains.toLocaleLowerCase());
    const excerpt = flat.slice(Math.max(0, at - 200), at + when.contains.length + 200).trim();
    return { patch, fired: `${when.url}${title} now shows “${when.contains}”:\n…${excerpt}…` };
  }
  const before = new Set(trigger.seen ?? []);
  const added = lines.filter((line, index) => !before.has(hashes[index]!));
  if (!added.some((line) => line.length >= 24)) return { patch };
  const shown = added.slice(0, 12).map((line) => `- ${line.length > 220 ? `${line.slice(0, 219)}…` : line}`);
  return { patch, fired: `${when.url}${title} has changed since it was last checked. New on the page:\n${shown.join('\n')}${added.length > 12 ? `\n(and ${plural(added.length - 12, 'more line')})` : ''}` };
};

const lookAtFolder = async (trigger: DotTrigger, when: Extract<DotTriggerWhen, { type: 'folder' }>, sources: TriggerSources, now: number, root: string | undefined): Promise<LookResult> => {
  if (!root) return failed('The folder this watches is no longer connected. Connect a folder in the dot\'s profile.', now, when);
  const result = await sources.folder(root, when.path ?? '.');
  if ('problem' in result) return failed(result.problem, now, when);
  const files = result.entries.filter((entry) => entry.type === 'file');
  const keyOf = (file: WatchedFile) => `${file.path}|${file.size ?? ''}|${file.modifiedAt ?? ''}`;
  const keys = files.map(keyOf).slice(0, 1_000);
  const patch: Partial<DotTrigger> = { seen: keys, primed: true, problem: undefined, nextAt: now + lookInterval(when) };
  if (!trigger.primed) return { patch };
  const before = new Map((trigger.seen ?? []).map((key) => [key.slice(0, key.indexOf('|')), key]));
  const current = new Set(files.map((file) => file.path));
  const added = files.filter((file) => !before.has(file.path)).map((file) => file.path);
  const changed = files.filter((file) => before.has(file.path) && before.get(file.path) !== keyOf(file)).map((file) => file.path);
  // A listing cut short cannot say what was removed.
  const removed = result.truncated ? [] : [...before.keys()].filter((path) => !current.has(path));
  if (!added.length && !changed.length && !removed.length) return { patch };
  const list = (label: string, paths: string[]) => (paths.length ? `${label}: ${paths.slice(0, 15).join(', ')}${paths.length > 15 ? ` and ${paths.length - 15} more` : ''}` : null);
  const parts = [list('added', added), list('changed', changed), list('removed', removed)].filter(Boolean);
  const where = isFullPath(when.path) ? when.path : `${when.path ? `${when.path} in ` : ''}the connected folder (${root})`;
  return { patch, fired: `Files changed in ${where} — ${parts.join('; ')}.` };
};

/** One look at whatever a polled trigger watches. */
export const look = async (trigger: DotTrigger, sources: TriggerSources, context: { now: number; root?: string }): Promise<LookResult> => {
  const { when } = trigger;
  try {
    switch (when.type) {
      case 'email':
        return await lookAtMail(trigger, when, sources, context.now);
      case 'calendar':
        return await lookAtCalendar(trigger, when, sources, context.now);
      case 'github':
        return await lookAtGithub(trigger, when, sources, context.now);
      case 'web_page':
        return await lookAtPage(trigger, when, sources, context.now);
      case 'folder':
        return await lookAtFolder(trigger, when, sources, context.now, context.root);
      default:
        return { patch: {} };
    }
  } catch (error) {
    return failed(`The last look failed (${error instanceof Error ? error.message : 'unknown error'}); Willow will try again.`, context.now, when);
  }
};

/* ------------------------------------------------------------------------ */
/* What the runtime hears rather than looks for                              */
/* ------------------------------------------------------------------------ */

export interface WatchedTask {
  id: string;
  title: string;
  status: string;
}

const TASK_SENTENCES: Record<string, string> = {
  complete: 'has finished',
  failed: 'has failed',
  'needs-input': 'is waiting for input (a question or a permission)',
};

const taskKey = (task: WatchedTask) => `${task.id}:${task.status}`;

/** The keys a Spark-task trigger starts with: every task as it is now, so only later changes fire it. */
export const sparkTaskKeys = (tasks: readonly WatchedTask[]): string[] => tasks.map(taskKey);

/** Spark tasks that reached the status a trigger watches for since it last heard. The bot's own tasks it hears about anyway. */
export const lookAtSparkTasks = (
  trigger: DotTrigger,
  tasks: readonly WatchedTask[],
  options: { excluded: ReadonlySet<string>; latestResponse: (taskId: string) => string },
): LookResult => {
  if (trigger.when.type !== 'spark_task') return { patch: {} };
  const when = trigger.when;
  const known = new Set(trigger.seen ?? []);
  const fresh = tasks.filter((task) => !known.has(taskKey(task)));
  if (fresh.length === 0) return { patch: {} };
  const patch: Partial<DotTrigger> = { seen: rememberSeen(trigger.seen, fresh.map(taskKey)), primed: true };
  const statuses = when.status === 'any' ? ['complete', 'failed', 'needs-input'] : [when.status];
  const matching = fresh.filter((task) => !options.excluded.has(task.id) && statuses.includes(task.status) && includes(task.title, when.match));
  if (matching.length === 0) return { patch };
  const lines = matching.slice(0, 5).map((task) => {
    const response = task.status === 'complete' ? options.latestResponse(task.id) : '';
    const excerpt = response ? `\n  Latest response (start): ${response.slice(0, 800).replace(/\s+/g, ' ')}${response.length > 800 ? ' …' : ''}` : '';
    return `- “${task.title}” (${task.id}) ${TASK_SENTENCES[task.status] ?? task.status}.${excerpt}`;
  });
  return { patch, fired: `${matching.length === 1 ? 'A Spark task changed' : `${matching.length} Spark tasks changed`}:\n${lines.join('\n')}` };
};

/** A Discord message as a trigger hears it. */
export interface HeardDiscordMessage {
  channelId: string;
  channelName?: string;
  /** A thread's channel. */
  parentName?: string;
  /** Null in a DM. */
  guildId: string | null;
  guildName?: string;
  author: { id: string; username: string; name: string };
  content: string;
  /** It mentions the bot, or answers one of its messages. */
  mentionsBot: boolean;
}

const sameName = (value: string | undefined, wanted: string): boolean => Boolean(value) && value!.toLocaleLowerCase() === wanted.toLocaleLowerCase();

/** Whether a Discord message is one a trigger watches for: every filter it has must hold. */
export const discordMatches = (when: Extract<DotTriggerWhen, { type: 'discord' }>, message: HeardDiscordMessage): boolean => {
  if (when.mentions && !message.mentionsBot) return false;
  if (when.channel) {
    const wanted = when.channel.trim().replace(/^#/, '');
    if (/^(dm|dms|direct)$/i.test(wanted)) {
      if (message.guildId !== null) return false;
    } else if (!(wanted === message.channelId || sameName(message.channelName, wanted) || sameName(message.parentName, wanted))) {
      return false;
    }
  }
  if (when.server && !(when.server === message.guildId || sameName(message.guildName, when.server.trim()))) return false;
  if (when.from) {
    const who = when.from.trim().replace(/^@/, '');
    if (!(who === message.author.id || sameName(message.author.username, who) || sameName(message.author.name, who))) return false;
  }
  return includes(message.content, when.match);
};

/** The user came back after `awayMs`: a return trigger fires once per return that is long enough. */
export const lookAtReturn = (trigger: DotTrigger, awayMs: number, now: number): LookResult => {
  if (trigger.when.type !== 'user_returns' || awayMs < trigger.when.awayHours * 3_600_000) return { patch: {} };
  if (trigger.lastRunAt !== undefined && trigger.lastRunAt > now - awayMs) return { patch: {} };
  return { patch: {}, fired: `The user is back in Willow after being away ${formatAgo(awayMs).replace(/ ago$/, '')}.` };
};
