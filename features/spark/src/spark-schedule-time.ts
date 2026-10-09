import type { SparkSchedule } from './spark-types';

/**
 * When a schedule runs next, after `after`: the scheduler's clock, and what a schedule
 * created anywhere — the editor, Spark's agent, Chat's tool — starts with.
 */
export const getNextScheduleRunAt = (schedule: Pick<SparkSchedule, 'frequency' | 'time' | 'weekdays'>, after = new Date()): string => {
  const [rawHour, rawMinute] = schedule.time.split(':').map(Number);
  const hour = Number.isFinite(rawHour) ? Math.min(23, Math.max(0, rawHour)) : 9;
  const minute = Number.isFinite(rawMinute) ? Math.min(59, Math.max(0, rawMinute)) : 0;
  const allowedDays = new Set(schedule.weekdays);
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  for (let offset = 0; offset <= 8; offset += 1) {
    const candidate = new Date(after);
    candidate.setSeconds(0, 0);
    candidate.setDate(after.getDate() + offset);
    candidate.setHours(hour, minute, 0, 0);
    const matchesDay = schedule.frequency === 'Daily'
      || allowedDays.has(weekdayNames[candidate.getDay()]);
    if (matchesDay && candidate.getTime() > after.getTime()) return candidate.toISOString();
  }

  const fallback = new Date(after);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(hour, minute, 0, 0);
  return fallback.toISOString();
};
