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

export type LibraryScheduleFrequency = 'Daily' | 'Weekly';

/** Full English weekday names, Sunday first: how Spark stores a schedule's days. */
export const LIBRARY_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export interface LibraryScheduleInput {
  title: string;
  frequency: LibraryScheduleFrequency;
  /** Full weekday names; empty for a daily schedule. */
  weekdays: string[];
  /** 24-hour `HH:mm`. */
  time: string;
  /** What each run is asked to do: the prompt it runs with. */
  instructions: string;
}

export interface LibrarySchedule extends LibraryScheduleInput {
  id: string;
  enabled: boolean;
  nextRunAt?: string;
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

/** "Weekly on Sun around 7:00 PM", "Daily around 8:00 AM": the Spark card's "When to run". */
export const formatScheduleWhen = (schedule: Pick<LibraryScheduleInput, 'frequency' | 'weekdays' | 'time'>): string => {
  const days = schedule.frequency === 'Weekly' ? ordered(schedule.weekdays) : [];
  return days.length
    ? `Weekly on ${days.map(dayAbbreviation).join(', ')} around ${formatScheduleClock(schedule.time)}`
    : `Daily around ${formatScheduleClock(schedule.time)}`;
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
export const scheduleCardBody = (schedule: Pick<LibraryScheduleInput, 'frequency' | 'weekdays' | 'time' | 'instructions'>): string =>
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

/** "Saturday by 10 AM", "Weekdays by 9 AM", "Daily by 8 AM": the chat card's schedule line. */
export const formatScheduleDue = (schedule: Pick<LibraryScheduleInput, 'frequency' | 'weekdays' | 'time'>): string => {
  const days = schedule.frequency === 'Weekly' ? ordered(schedule.weekdays) : [];
  const clock = shortClock(schedule.time);
  if (!days.length || days.length === LIBRARY_WEEKDAYS.length) return `Daily by ${clock}`;
  if (days.length === 1) return `${days[0]} by ${clock}`;
  if (days.join() === WEEKDAYS_ONLY.join()) return `Weekdays by ${clock}`;
  return `${days.map(dayAbbreviation).join(', ')} by ${clock}`;
};
