/**
 * How a bot paces itself when nobody has asked it anything: quiet hours, how much it has said since the user last
 * answered, and proactive moments — every few hours of the user's day — in which it looks for ways to help with
 * tools that look, take notes and plan. A plan made there is carried on straight after with every tool (plan.ts),
 * so what a moment finds becomes work done; acting on the world then follows the bot's Permissions.
 *
 * OpenAI's bots research in the background "using the apps you've already connected with tools that are restricted
 * to be read-only"; Willow's look the same way, while Willow is open, and only when there is something to look at.
 */
import { formatAgo } from '../memory/render';
import type { DotRuntimeState, DotThread } from '../thread/thread-types';
import { parseClock, zonedParts } from '../tools/zoned-time';

export interface QuietHours {
  /** `HH:MM`, local. */
  from: string;
  to: string;
  off?: boolean;
}

export const DEFAULT_QUIET_HOURS: QuietHours = { from: '22:00', to: '08:00' };

export const quietHoursOf = (runtime: Pick<DotRuntimeState, 'quietHours'> | undefined): QuietHours => runtime?.quietHours ?? DEFAULT_QUIET_HOURS;

const minutesOf = (clock: string) => {
  const parsed = parseClock(clock);
  return parsed ? parsed.hour * 60 + parsed.minute : null;
};

/** Whether `now` falls in the quiet hours, which may run past midnight. */
export const inQuietHours = (quiet: QuietHours, now: number, timeZone: string): boolean => {
  if (quiet.off) return false;
  const from = minutesOf(quiet.from);
  const to = minutesOf(quiet.to);
  if (from === null || to === null || from === to) return false;
  const parts = zonedParts(now, timeZone);
  const minute = parts.hour * 60 + parts.minute;
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
};

/** The line the bot reads while quiet hours are on, or null outside them. */
export const quietHoursLine = (runtime: Pick<DotRuntimeState, 'quietHours'>, now: number, timeZone: string): string | null => {
  const quiet = quietHoursOf(runtime);
  if (!inQuietHours(quiet, now, timeZone)) return null;
  return `It is the user's quiet hours (${quiet.from}–${quiet.to}): hold anything that can wait until ${quiet.to}. They will not be notified of messages unless they are writing to you.`;
};

/**
 * How much the bot has said since the user last wrote or reacted: the more it has, the higher the bar for saying
 * more. Null when it has said nothing since.
 */
export const pacingLine = (thread: Pick<DotThread, 'items'>, now: number): string | null => {
  let since = 0;
  let lastAt = 0;
  for (let index = thread.items.length - 1; index >= 0; index -= 1) {
    const item = thread.items[index]!;
    if (item.kind === 'user' || (item.kind === 'user-reaction' && !item.removed)) break;
    if (item.kind === 'dot' && !item.streaming) {
      since += 1;
      lastAt ||= item.at;
    }
  }
  if (since === 0) return null;
  return `You have sent ${since === 1 ? 'one message' : `${since} messages`} since the user last wrote or reacted (the latest ${formatAgo(now - lastAt)}).`;
};

/* ------------------------------------------------------------------------ */
/* Proactive research                                                        */
/* ------------------------------------------------------------------------ */

/**
 * How often a bot takes a moment of its own while the user is awake: every two and a half hours of their day,
 * outside quiet hours, so it keeps up with what it looks after without waiting to be asked.
 */
const MIN_GAP_MS = 150 * 60_000;
/** A moment waits for the user to have been quiet this long. */
const USER_QUIET_MS = 30 * 60_000;

/** The hour a moment belongs to, as `YYYY-MM-DD HH:00`: each is taken once. */
export const researchSlot = (_dotId: string, now: number, timeZone: string): string => {
  const parts = zonedParts(now, timeZone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:00`;
};

/**
 * Whether a bot should take a moment of its own now: they are on; the last was long enough ago; the bot is idle and
 * met the user; the user has gone quiet; it is not their quiet hours; and there is something to look at — connected
 * apps, or notes of its own about the user's world.
 */
export const researchDue = (thread: DotThread, now: number, timeZone: string, options: { hasApps: boolean }): string | null => {
  const runtime = thread.runtime;
  if (runtime.research?.off || runtime.status !== 'idle') return null;
  if (runtime.research?.lastAt && now - runtime.research.lastAt < MIN_GAP_MS) return null;
  const slot = researchSlot(thread.dotId, now, timeZone);
  if (runtime.research?.lastSlot === slot) return null;
  if (inQuietHours(quietHoursOf(runtime), now, timeZone)) return null;
  const lastUser = [...thread.items].reverse().find((item) => item.kind === 'user');
  if (!lastUser || now - lastUser.at < USER_QUIET_MS) return null;
  if (thread.items.some((item) => item.seq > runtime.lastActedSeq && item.kind !== 'user-reaction')) return null;
  const notes = Object.values(thread.notebook).some((file) => file.text.trim().length > 40);
  if (!options.hasApps && !notes) return null;
  return slot;
};

/** What the bot reads when a research moment begins. Delivered as an event; never shown in the conversation. */
export const RESEARCH_EVENT = `A quiet moment: nobody has asked you anything. Use it to look for ways to help.

Start from what you know — your notebook, open commitments, what the user is working on and what is coming up for them — and look at what you can reach that bears on it: their connected apps, what Willow knows about them, the web. In this moment your tools look, take notes and plan; nothing that sends, changes or controls anything is available.

Keep what you learn in your notebook. When you find work worth doing that is within what the user wants from you, plan it with update_plan: you will carry it on straight after, with all your tools, and anything that acts on the world still waits for the user's go-ahead. Message the user only if you found something that clearly meets your bar for reaching out now; otherwise keep it for a natural moment, when it will help them most. If there is nothing useful to do, end your turn.`;

/** Whether the turn about to run is a research moment: a research event is the only thing new to the bot. */
export const isResearchTurn = (thread: Pick<DotThread, 'items' | 'runtime'>): boolean => {
  const fresh = thread.items.filter((item) => item.seq > thread.runtime.lastActedSeq && item.kind !== 'user-reaction');
  return fresh.length > 0 && fresh.every((item) => item.kind === 'event' && item.event === 'research');
};

/**
 * The bot's own tools a research moment keeps: they look, recall and take notes, and change nothing outside the bot.
 * `update_plan` is among them, so something worth doing that a moment finds becomes work the bot carries on.
 */
const RESEARCH_TOOLS = new Set([
  'memory',
  'recall',
  'update_plan',
  'read_web_page',
  'retrieve_personal_data',
  'use_skill',
  'read_file',
  'list_files',
  'search_files',
  'check_spark_task',
  'list_spark_tasks',
  'check_helper',
  'user_files',
  'user_check_job',
]);

/** Whether a research moment may use a tool. `readTools` are the connected apps' read-only tools, by name. */
export const allowedInResearch = (toolId: string, readTools: ReadonlySet<string>): boolean => {
  if (toolId.startsWith('app:')) return readTools.has(toolId.slice(4));
  return RESEARCH_TOOLS.has(toolId);
};
