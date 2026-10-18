/**
 * Schedules and skills for surfaces other than Spark: what Chat's `create_schedule` and
 * `create_skill` tools write through, and what their cards read back.
 *
 * Spark owns both — its store, its Schedules and Skills pages, `Spark/Schedules/` and
 * `Skills/` in the user's folder — so it registers the writer here (`register.ts`), the
 * way it registers the skill library's hydrator. `platform/*` imports nothing from
 * `features/`, and this is how Chat reaches Spark without importing it.
 *
 * Schedules are mirrored the way skills are (`skill-library.ts`): Spark publishes on every
 * change, so a chat card shows its schedule as it is now — switched off, or deleted.
 *
 * The argument parsing lives here too, so a schedule asked for in Chat and one asked for
 * in a Spark task are read by the same rules.
 */
import { atom } from 'nanostores';

/** Gemini's Scheduled tab repeats: its Repeat menu, in its order. */
export type LibraryScheduleFrequency = 'Hourly' | 'Daily' | 'Weekly' | 'Monthly' | 'Yearly' | 'Once';

/** Full English weekday names, Sunday first: how Spark stores a schedule's days. */
export const LIBRARY_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export interface LibraryScheduleInput {
  title: string;
  frequency: LibraryScheduleFrequency;
  /** Full weekday names; empty for a daily schedule. */
  weekdays: string[];
  /** 24-hour `HH:mm`. An hourly schedule runs at `minute` instead. */
  time: string;
  /** What each run is asked to do: the prompt it runs with. */
  instructions: string;
  /** Hourly: the minute past each hour it runs, 0, 15, 30 or 45. */
  minute?: number;
  /** Monthly and yearly: the day of the month, 1-31; a shorter month runs on its last day. */
  dayOfMonth?: number;
  /** Yearly: the month, 0 for January to 11. */
  month?: number;
  /** Once: the local day it runs, `YYYY-MM-DD`. */
  date?: string;
  /** When it stops running, as an ISO time. Absent, it runs until paused or deleted. */
  endsAt?: string;
}

export interface LibrarySchedule extends LibraryScheduleInput {
  id: string;
  enabled: boolean;
  nextRunAt?: string;
  /** Set once it will not run again: a once-only schedule after its run, or one past its end. */
  completedAt?: string;
}

export interface LibrarySkillInput {
  /** Short and kebab-case, as Gemini names them: it is what `/` invokes. */
  name: string;
  /** When to use it: the only part a model reads before deciding to apply it. */
  description: string;
  /** The skill's body, in Markdown. */
  instructions: string;
}

export interface LibraryCreatedSkill extends LibrarySkillInput {
  id: string;
}

export interface SparkLibraryWriter {
  /**
   * Loads Spark's schedules and skills for this scope, at once, if nothing has yet: until
   * then both mirrors are empty, and an empty mirror reads as "everything was deleted".
   */
  hydrate(scopeId: string): void;
  createSchedule(scopeId: string, input: LibraryScheduleInput): LibrarySchedule | null;
  setScheduleEnabled(scopeId: string, scheduleId: string, enabled: boolean): LibrarySchedule | null;
  deleteSchedule(scopeId: string, scheduleId: string): boolean;
  createSkill(scopeId: string, input: LibrarySkillInput): LibraryCreatedSkill | null;
}

let writer: SparkLibraryWriter | null = null;

/** Called once, by Spark's registration module. */
export const registerSparkLibraryWriter = (next: SparkLibraryWriter): void => {
  writer = next;
};

/** Spark's writer, or null in a build without Spark (and in tests that stand none up). */
export const sparkLibraryWriter = (): SparkLibraryWriter | null => writer;

/* ------------------------------------------------------------------------ */
/* The schedule mirror                                                       */
/* ------------------------------------------------------------------------ */

export const librarySchedules = atom<readonly LibrarySchedule[]>([]);

const sameSchedule = (a: LibrarySchedule, b: LibrarySchedule): boolean =>
  a.id === b.id
  && a.title === b.title
  && a.frequency === b.frequency
  && a.time === b.time
  && a.instructions === b.instructions
  && a.enabled === b.enabled
  && a.nextRunAt === b.nextRunAt
  && a.completedAt === b.completedAt
  && a.minute === b.minute
  && a.dayOfMonth === b.dayOfMonth
  && a.month === b.month
  && a.date === b.date
  && a.endsAt === b.endsAt
  && a.weekdays.join() === b.weekdays.join();

/**
 * Replaces the mirror. Skips identical writes: Spark's publisher runs on every Spark state
 * change — run progress included — and re-setting the array would wake every card each time.
 */
export const publishSchedules = (schedules: readonly LibrarySchedule[]): void => {
  const current = librarySchedules.get();
  if (current.length === schedules.length && current.every((schedule, index) => sameSchedule(schedule, schedules[index]!))) return;
  librarySchedules.set(schedules.map((schedule) => ({ ...schedule, weekdays: [...schedule.weekdays] })));
};

/* ------------------------------------------------------------------------ */
/* Reading what a model asked for                                            */
/* ------------------------------------------------------------------------ */

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const DAY_ALIASES: Record<string, (typeof LIBRARY_WEEKDAYS)[number]> = Object.fromEntries(
  LIBRARY_WEEKDAYS.flatMap((day) => {
    const lower = day.toLowerCase();
    return [[lower, day], [lower.slice(0, 3), day], [lower.slice(0, 2), day]];
  }).concat([['tues', 'Tuesday'], ['thur', 'Thursday'], ['thurs', 'Thursday']]),
) as Record<string, (typeof LIBRARY_WEEKDAYS)[number]>;

/** "monday", "Mon", "MO" — any day a model writes, as Spark stores it. */
const normalizeWeekday = (value: unknown): (typeof LIBRARY_WEEKDAYS)[number] | null => {
  const key = text(value).toLowerCase().replace(/[^a-z]/g, '');
  return DAY_ALIASES[key] ?? null;
};

/** "19:00", "7 PM", "7:30pm", "07:00" as 24-hour `HH:mm`; null when it is not a time. */
export const normalizeScheduleTime = (value: unknown): string | null => {
  const raw = text(value).toLowerCase().replace(/\s+/g, '');
  const match = /^(\d{1,2})(?::?(\d{2}))?(am|pm|a\.m\.|p\.m\.)?$/.exec(raw);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const meridiem = match[3]?.replace(/\./g, '');
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const MAX_TITLE = 80;
const MAX_INSTRUCTIONS = 8_000;

/**
 * A `create_schedule` call's arguments as a schedule, or what is wrong with them in words
 * the model can act on. Weekly with no days reads as every day; weekly with all seven, too.
 */
export const scheduleInputFrom = (args: Record<string, unknown>): { input: LibraryScheduleInput } | { error: string } => {
  const title = text(args.title).replace(/\s+/g, ' ').slice(0, MAX_TITLE);
  const instructions = text(args.instructions) || text(args.prompt) || text(args.task);
  if (!title) return { error: 'create_schedule needs a "title": a short name for the schedule, such as "Send weekly science fact".' };
  if (!instructions) return { error: 'create_schedule needs "instructions": what to do on each run, written to yourself as the task to carry out.' };
  const time = normalizeScheduleTime(args.time);
  if (!time) return { error: `create_schedule needs a "time" of day as 24-hour HH:mm, such as "19:00"; ${JSON.stringify(args.time ?? null)} is not one.` };
  const requested = text(args.frequency).toLowerCase();
  const rawDays = Array.isArray(args.weekdays) ? args.weekdays : Array.isArray(args.days) ? args.days : [];
  const days = LIBRARY_WEEKDAYS.filter((day) => rawDays.some((value) => normalizeWeekday(value) === day));
  if (rawDays.length && !days.length) {
    return { error: `create_schedule could not read the days ${JSON.stringify(rawDays)}; use full English weekday names, such as ["Sunday"].` };
  }
  const weekly = requested === 'weekly' || (requested !== 'daily' && days.length > 0);
  const everyDay = !weekly || days.length === 0 || days.length === LIBRARY_WEEKDAYS.length;
  return {
    input: {
      title,
      frequency: everyDay ? 'Daily' : 'Weekly',
      weekdays: everyDay ? [] : days,
      time,
      instructions: instructions.slice(0, MAX_INSTRUCTIONS),
    },
  };
};

/** Gemini's skill names are kebab-case: "article-key-takeaways". */
export const normalizeSkillName = (value: unknown): string => text(value)
  .toLowerCase()
  .replace(/^\/+/, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 64)
  .replace(/-+$/g, '');

/**
 * A `create_skill` call's arguments as a skill, or what is wrong with them. `taken` is the
 * library's names: a second skill under one name would make "/" ambiguous.
 */
export const skillInputFrom = (
  args: Record<string, unknown>,
  taken: readonly string[] = [],
): { input: LibrarySkillInput } | { error: string } => {
  const name = normalizeSkillName(args.name);
  const description = text(args.description).replace(/\s+/g, ' ');
  const instructions = text(args.instructions);
  if (!name) return { error: 'create_skill needs a "name": short and kebab-case, such as "article-key-takeaways".' };
  if (taken.some((existing) => normalizeSkillName(existing) === name)) {
    return { error: `A skill named "${name}" already exists. Choose another name, or tell the user it is already saved.` };
  }
  if (!description) return { error: 'create_skill needs a "description": one or two sentences on what it does and when to use it.' };
  if (!instructions) return { error: 'create_skill needs "instructions": the skill itself, in Markdown.' };
  return { input: { name, description: description.slice(0, 600), instructions: instructions.slice(0, MAX_INSTRUCTIONS) } };
};

/* ------------------------------------------------------------------------ */
/* How a schedule reads                                                      */
/* ------------------------------------------------------------------------ */

const dayAbbreviation = (day: string): string => day.slice(0, 3);

const ordered = (days: readonly string[]): string[] =>
  LIBRARY_WEEKDAYS.filter((day) => days.includes(day));

/** "7:00 PM": Gemini's Spark card and Schedules list. */
export const formatScheduleClock = (time: string): string => {
  const [rawHour, rawMinute = '00'] = time.split(':');
  const hour = Number(rawHour);
  if (!Number.isFinite(hour)) return time;
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${rawMinute.padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
};

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1st", "22nd", "13th": Gemini's `{DAY, selectordinal}`. */
export const formatScheduleOrdinal = (day: number): string => {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  switch (day % 10) {
    case 1: return `${day}st`;
    case 2: return `${day}nd`;
    case 3: return `${day}rd`;
    default: return `${day}th`;
  }
};

/** "15 Oct 2026" from `2026-10-15`, as Gemini's en-IN short date reads; "" when it is not one. */
export const formatScheduleDate = (date: string | undefined, withYear = true): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  if (!match) return '';
  const month = MONTHS_SHORT[Number(match[2]) - 1];
  if (!month) return '';
  return `${Number(match[3])} ${month}${withYear ? ` ${match[1]}` : ''}`;
};

type ScheduleTiming = Pick<LibraryScheduleInput, 'frequency' | 'weekdays' | 'time'>
  & Partial<Pick<LibraryScheduleInput, 'minute' | 'dayOfMonth' | 'month' | 'date'>>;

const yearDay = (schedule: ScheduleTiming): string =>
  `${schedule.dayOfMonth ?? 1} ${MONTHS_SHORT[schedule.month ?? 0] ?? MONTHS_SHORT[0]}`;

/**
 * "Weekly on Sun around 7:00 PM", "Daily around 8:00 AM": the Spark card's "When to run". The
 * other repeats read as Gemini's schedule summary does ("Monthly on 15th around 7:00 PM").
 */
export const formatScheduleWhen = (schedule: ScheduleTiming): string => {
  const clock = formatScheduleClock(schedule.time);
  switch (schedule.frequency) {
    case 'Hourly':
      return schedule.minute ? `Hourly around the ${schedule.minute}-min mark` : 'Hourly around the top of the hour';
    case 'Monthly':
      return `Monthly on ${formatScheduleOrdinal(schedule.dayOfMonth ?? 1)} around ${clock}`;
    case 'Yearly':
      return `Yearly on ${yearDay(schedule)} around ${clock}`;
    case 'Once':
      return `Will run once on ${formatScheduleDate(schedule.date) || 'a date to be set'} around ${clock}`;
    default: {
      const days = schedule.frequency === 'Weekly' ? ordered(schedule.weekdays) : [];
      return days.length
        ? `Weekly on ${days.map(dayAbbreviation).join(', ')} around ${clock}`
        : `Daily around ${clock}`;
    }
  }
};

/** "10 AM", "7:30 PM": Gemini chat's scheduled-action card drops a round hour's minutes. */
const shortClock = (time: string): string => {
  const [rawHour, rawMinute = '00'] = time.split(':');
  const hour = Number(rawHour);
  if (!Number.isFinite(hour)) return time;
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  const minutes = Number(rawMinute) ? `:${rawMinute.padStart(2, '0')}` : '';
  return `${displayHour}${minutes} ${hour < 12 ? 'AM' : 'PM'}`;
};

/* ------------------------------------------------------------------------ */
/* The saved-item card's body                                                */
/* ------------------------------------------------------------------------ */

/** A schedule's card, as Gemini's Spark draws it: "When to run:", then "What to do:". */
export const scheduleCardBody = (schedule: ScheduleTiming & Pick<LibraryScheduleInput, 'instructions'>): string =>
  `#### When to run:\n\n${formatScheduleWhen(schedule)}\n\n#### What to do:\n\n${schedule.instructions}`;

/** A skill's card, as Gemini's chat draws it: its description, then "Instructions" and the skill. */
export const skillCardBody = (skill: Pick<LibrarySkillInput, 'description' | 'instructions'>): string =>
  `${skill.description}\n\n#### Instructions\n\n${skill.instructions}`;

/**
 * Under a schedule's card, where Gemini warns about its usage limits. Willow's schedules
 * run in the browser instead, so what is worth knowing is when.
 */
export const SCHEDULE_CARD_DISCLAIMER = 'Schedules run at approximate times while Willow is open. One that comes due while it is closed runs the next time you open it.';

const WEEKDAYS_ONLY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

/**
 * "Saturday by 10 AM", "Weekdays by 9 AM", "Daily by 8 AM": the chat card's schedule line. Gemini's
 * card only ever read daily and weekly schedules; the other repeats follow its pattern.
 */
export const formatScheduleDue = (schedule: ScheduleTiming): string => {
  const clock = shortClock(schedule.time);
  switch (schedule.frequency) {
    case 'Hourly':
      return `Hourly at :${String(schedule.minute ?? 0).padStart(2, '0')}`;
    case 'Monthly':
      return `${formatScheduleOrdinal(schedule.dayOfMonth ?? 1)} of each month by ${clock}`;
    case 'Yearly':
      return `${yearDay(schedule)} each year by ${clock}`;
    case 'Once':
      return `${formatScheduleDate(schedule.date) || 'Once'} by ${clock}`;
    default:
      break;
  }
  const days = schedule.frequency === 'Weekly' ? ordered(schedule.weekdays) : [];
  if (!days.length || days.length === LIBRARY_WEEKDAYS.length) return `Daily by ${clock}`;
  if (days.length === 1) return `${days[0]} by ${clock}`;
  if (days.join() === WEEKDAYS_ONLY.join()) return `Weekdays by ${clock}`;
  return `${days.map(dayAbbreviation).join(', ')} by ${clock}`;
};
