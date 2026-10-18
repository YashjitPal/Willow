/**
 * The Scheduled tab's rules, apart from React: which section a schedule is in, how a row reads,
 * what the editor's form holds and when it can be saved, and every dropdown's options. Each is
 * Gemini's (`scheduled-tasks-tab`, `scheduled-tasks-side-pane` and `scheduled-dropdown` in
 * tools/ui-research/captures/gemini/scheduled/bundle/chunk.js).
 */
import { formatScheduleClock, formatScheduleOrdinal } from '@willow/core/spark-library';
import type { SparkSchedule, SparkScheduleFrequency, SparkTask } from '../spark-types';
import type { SparkScheduleInput } from '../spark-store';

/* ------------------------------------------------------------------------ */
/* The list                                                                  */
/* ------------------------------------------------------------------------ */

export type ScheduledFilter = 'ALL' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';

/** The status filter's menu: Gemini's `filter_list` comes from Google Symbols, the rest from Luminous. */
export const SCHEDULED_FILTERS: readonly { value: ScheduledFilter; label: string; icon: string; family: 'google-symbols' | 'luminous' }[] = [
  { value: 'ALL', label: 'All', icon: 'filter_list', family: 'google-symbols' },
  { value: 'ACTIVE', label: 'Active', icon: 'play_circle', family: 'luminous' },
  { value: 'PAUSED', label: 'Paused', icon: 'pause_circle', family: 'luminous' },
  { value: 'COMPLETED', label: 'Completed', icon: 'check_circle', family: 'luminous' },
];

export const scheduledFilterLabel = (filter: ScheduledFilter): string =>
  SCHEDULED_FILTERS.find((entry) => entry.value === filter)?.label ?? 'All';

/** What a filtered section says when it has nothing; All never shows one. */
export const scheduledEmptyText = (filter: ScheduledFilter): string => {
  switch (filter) {
    case 'ACTIVE': return "You don't have any active tasks";
    case 'PAUSED': return "You don't have any paused tasks";
    case 'COMPLETED': return "You don't have any completed tasks";
    default: return '';
  }
};

export type ScheduleSection = 'active' | 'paused' | 'completed';

export const scheduleSection = (schedule: Pick<SparkSchedule, 'enabled' | 'completedAt'>): ScheduleSection =>
  schedule.completedAt ? 'completed' : schedule.enabled ? 'active' : 'paused';

export interface ScheduledSections {
  active: SparkSchedule[];
  paused: SparkSchedule[];
  completed: SparkSchedule[];
}

export const partitionSchedules = (schedules: readonly SparkSchedule[]): ScheduledSections => {
  const sections: ScheduledSections = { active: [], paused: [], completed: [] };
  for (const schedule of schedules) sections[scheduleSection(schedule)].push(schedule);
  return sections;
};

/**
 * Which sections show, and whether each is its empty text: Gemini shows a section under All only
 * when it has rows, and under its own filter always, empty or not. Suggested shows under All.
 */
export const visibleSections = (filter: ScheduledFilter, sections: ScheduledSections): { section: ScheduleSection; empty: boolean }[] => {
  const order: ScheduleSection[] = ['active', 'paused', 'completed'];
  const own: Record<ScheduleSection, ScheduledFilter> = { active: 'ACTIVE', paused: 'PAUSED', completed: 'COMPLETED' };
  return order
    .filter((section) => (filter === 'ALL' && sections[section].length > 0) || filter === own[section])
    .map((section) => ({ section, empty: sections[section].length === 0 }));
};

export const SECTION_TITLES: Record<ScheduleSection, string> = { active: 'Active', paused: 'Paused', completed: 'Completed' };

const relativeTime = new Intl.RelativeTimeFormat('en-IN', { numeric: 'always', style: 'narrow' });

/** Gemini's `nTf`: "Just now", "6 hr ago", "3 days ago", "4 mo ago", from minutes elapsed. */
export const formatScheduledAgo = (minutes: number): string | undefined => {
  if (!Number.isFinite(minutes) || minutes < 0) return undefined;
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return relativeTime.format(-Math.floor(minutes), 'minute');
  if (minutes < 1440) return relativeTime.format(-Math.floor(minutes / 60), 'hour');
  if (minutes < 10080) return relativeTime.format(-Math.floor(minutes / 1440), 'day');
  if (minutes < 43200) return relativeTime.format(-Math.floor(minutes / 10080), 'week');
  if (minutes < 525960) return relativeTime.format(-Math.floor(minutes / 43200), 'month');
  return relativeTime.format(-Math.floor(minutes / 525960), 'year');
};

/** "Daily · Last run 6 hr ago", "Weekly · Waiting to run": a row's second line. */
export const scheduleSubtitle = (schedule: Pick<SparkSchedule, 'frequency' | 'lastRunAt'>, now: number): string => {
  let lastRun: string;
  if (!schedule.lastRunAt) {
    lastRun = 'Waiting to run';
  } else {
    const ago = formatScheduledAgo(Math.floor((now - new Date(schedule.lastRunAt).getTime()) / 60_000));
    lastRun = ago ? `Last run ${ago}` : '';
  }
  return lastRun ? `${schedule.frequency} \u00b7 ${lastRun}` : schedule.frequency;
};

export type ScheduleBadge = 'needs-input' | 'in-progress' | 'unread';

/** Gemini's `remy-goal-status-badge` for the task a schedule runs in. */
export const scheduleBadge = (task: Pick<SparkTask, 'status' | 'hasUnreadCompletion'> | undefined): ScheduleBadge | null => {
  if (!task) return null;
  if (task.status === 'needs-input') return 'needs-input';
  if (task.status === 'queued' || task.status === 'running') return 'in-progress';
  return task.hasUnreadCompletion ? 'unread' : null;
};

export const SCHEDULE_BADGE_TOOLTIPS: Record<ScheduleBadge, string> = {
  'needs-input': 'Needs input',
  'in-progress': 'In progress',
  unread: 'Unread',
};

export interface ScheduledSuggestion {
  id: string;
  title: string;
  description: string;
}

/** Gemini's Suggested section, as it reads in the reference account. A row sends its description. */
export const SCHEDULED_SUGGESTIONS: readonly ScheduledSuggestion[] = [
  { id: 'subscriptions', title: 'Organise my subscriptions', description: 'Scan my Gmail weekly and recommend subscriptions to cut.' },
  { id: 'wellness', title: 'Recommend wellness tips', description: 'Get a weekly wellness digest based on the latest health research.' },
  { id: 'local-events', title: 'Recommend local events', description: 'Find local events based on my interests and add them to my calendar.' },
  { id: 'email-drafts', title: 'Draft email responses', description: 'Check my inbox for new emails, summarise them and draft replies.' },
  { id: 'progress-report', title: 'Create a work progress report', description: 'Write a daily summary based on my Calendar and Gmail activity.' },
];

/* ------------------------------------------------------------------------ */
/* The editor's form                                                         */
/* ------------------------------------------------------------------------ */

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type ScheduleEnds = 'never' | 'specific';

/** The pane's controls, as Gemini's form holds them. Days are 0 (Sunday) to 6. */
export interface ScheduleForm {
  title: string;
  plan: string;
  frequency: SparkScheduleFrequency;
  minute: number;
  days: number[];
  dayOfMonth: number;
  month: number;
  yearDay: number;
  date: string;
  time: string;
  ends: ScheduleEnds;
  endDate: string;
  endTime: string;
}

/** A new weekly schedule's days: Monday, Wednesday and Friday. */
export const DEFAULT_SCHEDULE_DAYS = [1, 3, 5];

const pad = (value: number): string => String(value).padStart(2, '0');

/** `YYYY-MM-DD` for a local day. */
export const isoDay = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** A local day from `YYYY-MM-DD`, at midnight; null when it is not one. */
export const parseIsoDay = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
};

/** Gemini's default end: a month from today, on today's date or the month's last day. */
export const defaultEndDate = (now: Date): string => {
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const last = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
  end.setDate(Math.min(now.getDate(), last));
  return isoDay(end);
};

/** A new schedule: daily at 5:00 PM, never ending, and today wherever a day is asked for. */
export const blankScheduleForm = (now: Date): ScheduleForm => ({
  title: '',
  plan: '',
  frequency: 'Daily',
  minute: 0,
  days: [...DEFAULT_SCHEDULE_DAYS],
  dayOfMonth: now.getDate(),
  month: now.getMonth(),
  yearDay: now.getDate(),
  date: isoDay(now),
  time: '17:00',
  ends: 'never',
  endDate: '',
  endTime: '08:00',
});

const clockOf = (iso: string | undefined): string => {
  const date = iso ? new Date(iso) : null;
  return date && Number.isFinite(date.getTime()) ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : '08:00';
};

export const formFromSchedule = (schedule: SparkSchedule, now: Date): ScheduleForm => {
  const days = schedule.weekdays.map((name) => WEEKDAY_NAMES.indexOf(name)).filter((day) => day >= 0).sort((a, b) => a - b);
  const end = schedule.endsAt ? new Date(schedule.endsAt) : null;
  const hasEnd = Boolean(end && Number.isFinite(end.getTime()));
  return {
    title: schedule.title,
    plan: schedule.instructions,
    frequency: schedule.frequency,
    minute: schedule.minute ?? 0,
    days: schedule.frequency === 'Weekly' && days.length === 0 ? [...DEFAULT_SCHEDULE_DAYS] : days,
    dayOfMonth: schedule.dayOfMonth ?? now.getDate(),
    month: schedule.month ?? now.getMonth(),
    yearDay: schedule.dayOfMonth ?? now.getDate(),
    date: schedule.date ?? isoDay(now),
    time: schedule.time,
    ends: hasEnd ? 'specific' : 'never',
    endDate: hasEnd ? isoDay(end!) : '',
    endTime: hasEnd ? clockOf(schedule.endsAt) : '08:00',
  };
};

/** Repeat changed: a switch into Weekly starts on Monday, Wednesday and Friday, as Gemini's does. */
export const withFrequency = (form: ScheduleForm, frequency: SparkScheduleFrequency): ScheduleForm => ({
  ...form,
  frequency,
  days: frequency === 'Weekly' && form.frequency !== 'Weekly' ? [...DEFAULT_SCHEDULE_DAYS] : form.days,
});

/** Ends changed: "On date" starts a month out at 8:00 AM unless one was already picked. */
export const withEnds = (form: ScheduleForm, ends: ScheduleEnds, now: Date, savedEndTime = '08:00'): ScheduleForm => (ends === 'never'
  ? { ...form, ends, endDate: '', endTime: savedEndTime }
  : { ...form, ends, endDate: form.endDate || defaultEndDate(now), endTime: form.endTime || '08:00' });

/** Once has no Ends card; Hourly has no Time row. */
export const showsEnds = (frequency: SparkScheduleFrequency): boolean => frequency !== 'Once';

/**
 * The form as Gemini compares it: what the current Repeat does not use keeps its saved value,
 * so switching to Monthly and back to Daily is no change.
 */
const comparable = (form: ScheduleForm, base: ScheduleForm) => {
  const f = form.frequency;
  return {
    title: form.title.trim(),
    plan: form.plan.trim(),
    frequency: f,
    minute: f === 'Hourly' ? form.minute : base.minute,
    days: (f === 'Weekly' ? form.days : base.days).join(),
    dayOfMonth: f === 'Monthly' ? form.dayOfMonth : base.dayOfMonth,
    month: f === 'Yearly' ? form.month : base.month,
    yearDay: f === 'Yearly' ? form.yearDay : base.yearDay,
    date: f === 'Once' ? form.date : base.date,
    time: f === 'Hourly' ? base.time : form.time,
    ends: f === 'Once' ? 'never' : form.ends,
    endDate: f === 'Once' ? base.endDate : form.ends === 'specific' ? form.endDate : '',
    endTime: f === 'Once' ? base.endTime : form.ends === 'specific' ? form.endTime : base.endTime,
  };
};

export const isFormChanged = (form: ScheduleForm, base: ScheduleForm): boolean => {
  const a = comparable(form, base);
  const b = comparable(base, base);
  return (Object.keys(a) as (keyof typeof a)[]).some((key) => a[key] !== b[key]);
};

/** Create needs a name and a plan; Save, those and a change. */
export const canSaveForm = (form: ScheduleForm, base: ScheduleForm, creating: boolean): boolean =>
  Boolean(form.title.trim() && form.plan.trim()) && (creating || isFormChanged(form, base));

/** The form as Spark stores a schedule: only what its Repeat uses. */
export const scheduleInputFromForm = (form: ScheduleForm): Omit<SparkScheduleInput, 'enabled'> => {
  const f = form.frequency;
  const endsAt = f !== 'Once' && form.ends === 'specific' ? parseIsoDay(form.endDate) : null;
  if (endsAt) {
    const [hour, minute] = form.endTime.split(':').map(Number);
    endsAt.setHours(Number.isFinite(hour) ? hour : 8, Number.isFinite(minute) ? minute : 0, 0, 0);
  }
  return {
    title: form.title.trim(),
    instructions: form.plan.trim(),
    frequency: f,
    weekdays: f === 'Weekly' ? [...form.days].sort((a, b) => a - b).map((day) => WEEKDAY_NAMES[day]!) : [],
    time: form.time,
    minute: f === 'Hourly' ? form.minute : undefined,
    dayOfMonth: f === 'Monthly' ? form.dayOfMonth : f === 'Yearly' ? form.yearDay : undefined,
    month: f === 'Yearly' ? form.month : undefined,
    date: f === 'Once' ? form.date : undefined,
    endsAt: endsAt ? endsAt.toISOString() : undefined,
  };
};

/* ------------------------------------------------------------------------ */
/* Dropdown options                                                          */
/* ------------------------------------------------------------------------ */

export interface DropdownOption<T> {
  value: T;
  label: string;
}

export const REPEAT_OPTIONS: readonly DropdownOption<SparkScheduleFrequency>[] = [
  { value: 'Hourly', label: 'Hourly' },
  { value: 'Daily', label: 'Daily' },
  { value: 'Weekly', label: 'Weekly' },
  { value: 'Monthly', label: 'Monthly' },
  { value: 'Yearly', label: 'Yearly' },
  { value: 'Once', label: 'Once' },
];

export const ENDS_OPTIONS: readonly DropdownOption<ScheduleEnds>[] = [
  { value: 'never', label: 'Never' },
  { value: 'specific', label: 'On date' },
];

/** The Days menu runs Monday to Sunday. */
export const WEEKDAY_OPTIONS: readonly DropdownOption<number>[] = [1, 2, 3, 4, 5, 6, 0].map((day) => ({ value: day, label: WEEKDAY_NAMES[day]! }));

export const MONTH_OPTIONS: readonly DropdownOption<number>[] = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
].map((label, value) => ({ value, label }));

export const MONTH_DAY_OPTIONS: readonly DropdownOption<number>[] = Array.from({ length: 31 }, (_, index) => ({ value: index + 1, label: String(index + 1) }));

/** A yearly schedule's days: the month's, in a leap year, so 29 February can be picked. */
export const yearDayOptions = (month: number): DropdownOption<number>[] =>
  Array.from({ length: new Date(2024, month + 1, 0).getDate() }, (_, index) => ({ value: index + 1, label: String(index + 1) }));

/** Gemini keeps a picked day inside the newly chosen month. */
export const clampYearDay = (month: number, day: number): number => Math.min(day, new Date(2024, month + 1, 0).getDate());

export const minuteLabel = (minute: number): string => `:${pad(minute)}`;

/** :00, :15, :30, :45, and a schedule's own minute when it is another. */
export const minuteOptions = (current: number): DropdownOption<number>[] => {
  const values = [0, 15, 30, 45];
  if (!values.includes(current)) values.push(current);
  return values.sort((a, b) => a - b).map((value) => ({ value, label: minuteLabel(value) }));
};

/** The 24 hours, 12:00 AM to 11:00 PM, and a schedule's own time when it is between them. */
export const timeOptions = (current: string): DropdownOption<string>[] => {
  const values = Array.from({ length: 24 }, (_, hour) => `${pad(hour)}:00`);
  if (/^\d{2}:\d{2}$/.test(current) && !values.includes(current)) values.push(current);
  return values.sort().map((value) => ({ value, label: formatScheduleClock(value) }));
};

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_INITIALS = ['S', 'M', 'Tu', 'W', 'Th', 'F', 'S'];
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

/** The Days trigger: "Every day", "Weekdays", "Weekends", "Sun", "M, W, F" or "Select days". */
export const daysSummary = (days: readonly number[]): string => {
  const set = new Set(days);
  if (set.size === 7) return 'Every day';
  if (set.size === 5 && [1, 2, 3, 4, 5].every((day) => set.has(day))) return 'Weekdays';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends';
  if (set.size === 0) return 'Select days';
  if (set.size === 1) return SHORT_DAYS[[...set][0]!]!;
  return MONDAY_FIRST.filter((day) => set.has(day)).map((day) => DAY_INITIALS[day]).join(', ');
};

export const monthDaySummary = (day: number): string => formatScheduleOrdinal(day);

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "15 Oct 2026": the Date buttons, as Gemini's en-IN short date reads. */
export const formatPaneDate = (value: string): string => {
  const date = parseIsoDay(value);
  return date ? `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}` : '';
};

/* ------------------------------------------------------------------------ */
/* The calendar                                                              */
/* ------------------------------------------------------------------------ */

export interface CalendarCell {
  day: number;
  iso: string;
  disabled: boolean;
  today: boolean;
}

/** One month of Material's month view, Sunday first: leading blanks, then each day. */
export const calendarMonth = (year: number, month: number, today: Date): { label: string; offset: number; cells: CalendarCell[] } => {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const todayIso = isoDay(today);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return {
    label: `${MONTHS_SHORT[month]!.toUpperCase()} ${year}`,
    offset: first.getDay(),
    cells: Array.from({ length: days }, (_, index) => {
      const date = new Date(year, month, index + 1);
      return { day: index + 1, iso: isoDay(date), disabled: date.getTime() < startOfToday, today: isoDay(date) === todayIso };
    }),
  };
};

export const CALENDAR_WEEKDAYS: readonly { short: string; long: string }[] = [
  { short: 'S', long: 'Sunday' }, { short: 'M', long: 'Monday' }, { short: 'T', long: 'Tuesday' }, { short: 'W', long: 'Wednesday' },
  { short: 'T', long: 'Thursday' }, { short: 'F', long: 'Friday' }, { short: 'S', long: 'Saturday' },
];
