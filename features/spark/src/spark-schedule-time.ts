import type { SparkSchedule } from './spark-types';

/** What decides when a schedule runs; the rest of a schedule never does. */
export type SparkScheduleTiming = Pick<SparkSchedule, 'frequency' | 'time' | 'weekdays'>
  & Partial<Pick<SparkSchedule, 'minute' | 'dayOfMonth' | 'month' | 'date' | 'endsAt'>>;

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const clockOf = (time: string): { hour: number; minute: number } => {
  const [rawHour, rawMinute] = time.split(':').map(Number);
  return {
    hour: Number.isFinite(rawHour) ? clamp(rawHour, 0, 23) : 9,
    minute: Number.isFinite(rawMinute) ? clamp(rawMinute, 0, 59) : 0,
  };
};

const lastDayOf = (year: number, month: number): number => new Date(year, month + 1, 0).getDate();

/** The local moment a once-only schedule is set for, or null when its date is not one. */
export const onceScheduleMoment = (schedule: Pick<SparkSchedule, 'time'> & Pick<Partial<SparkSchedule>, 'date'>): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(schedule.date ?? '');
  if (!match) return null;
  const { hour, minute } = clockOf(schedule.time);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, minute, 0, 0);
};

const nextRun = (schedule: SparkScheduleTiming, after: Date): Date | null => {
  const { hour, minute } = clockOf(schedule.time);
  switch (schedule.frequency) {
    case 'Hourly': {
      const candidate = new Date(after);
      candidate.setSeconds(0, 0);
      candidate.setMinutes(clamp(schedule.minute ?? 0, 0, 59));
      if (candidate.getTime() <= after.getTime()) candidate.setHours(candidate.getHours() + 1);
      return candidate;
    }
    case 'Monthly': {
      const day = clamp(schedule.dayOfMonth ?? 1, 1, 31);
      for (let offset = 0; offset < 14; offset += 1) {
        const month = new Date(after.getFullYear(), after.getMonth() + offset, 1);
        const candidate = new Date(month.getFullYear(), month.getMonth(), Math.min(day, lastDayOf(month.getFullYear(), month.getMonth())), hour, minute, 0, 0);
        if (candidate.getTime() > after.getTime()) return candidate;
      }
      return null;
    }
    case 'Yearly': {
      const month = clamp(schedule.month ?? 0, 0, 11);
      const day = clamp(schedule.dayOfMonth ?? 1, 1, 31);
      for (let year = after.getFullYear(); year <= after.getFullYear() + 1; year += 1) {
        const candidate = new Date(year, month, Math.min(day, lastDayOf(year, month)), hour, minute, 0, 0);
        if (candidate.getTime() > after.getTime()) return candidate;
      }
      return null;
    }
    case 'Once': {
      const moment = onceScheduleMoment(schedule);
      return moment && moment.getTime() > after.getTime() ? moment : null;
    }
    default: {
      const allowedDays = new Set(schedule.weekdays);
      for (let offset = 0; offset <= 8; offset += 1) {
        const candidate = new Date(after);
        candidate.setSeconds(0, 0);
        candidate.setDate(after.getDate() + offset);
        candidate.setHours(hour, minute, 0, 0);
        const matchesDay = schedule.frequency === 'Daily'
          || allowedDays.has(WEEKDAY_NAMES[candidate.getDay()]);
        if (matchesDay && candidate.getTime() > after.getTime()) return candidate;
      }
      const fallback = new Date(after);
      fallback.setDate(fallback.getDate() + 1);
      fallback.setHours(hour, minute, 0, 0);
      return fallback;
    }
  }
};

/**
 * When a schedule runs next, after `after`: the scheduler's clock, and what a schedule
 * created anywhere — the Scheduled tab, Spark's agent, Chat's tool — starts with.
 * Undefined when it never runs again: a once-only schedule past its moment, or a run that
 * would fall after the schedule's end.
 */
export const getNextScheduleRunAt = (schedule: SparkScheduleTiming, after = new Date()): string | undefined => {
  const next = nextRun(schedule, after);
  if (!next) return undefined;
  const end = schedule.endsAt ? new Date(schedule.endsAt).getTime() : Number.NaN;
  if (Number.isFinite(end) && next.getTime() > end) return undefined;
  return next.toISOString();
};

/**
 * A schedule's first run as it is saved. A once-only schedule set for a moment that has just
 * passed still runs, on the scheduler's next check, rather than completing without running.
 */
export const getFirstScheduleRunAt = (schedule: SparkScheduleTiming, now = new Date()): string | undefined => {
  if (schedule.frequency === 'Once') {
    const moment = onceScheduleMoment(schedule);
    return moment ? moment.toISOString() : undefined;
  }
  return getNextScheduleRunAt(schedule, now);
};
