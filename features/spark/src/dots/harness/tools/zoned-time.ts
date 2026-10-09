/**
 * Wall-clock arithmetic in the user's time zone, with only `Intl`.
 *
 * A bot schedules in local time ("weekdays at 9"), but timers run on epoch
 * milliseconds. Converting needs the zone's offset at that instant, which shifts
 * across daylight-saving changes, so every conversion is checked twice.
 */

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday. */
  weekday: number;
}

const FORMATS = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const formatFor = (timeZone: string): Intl.DateTimeFormat => {
  let format = FORMATS.get(timeZone);
  if (!format) {
    const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23' };
    try {
      format = new Intl.DateTimeFormat('en-US', { ...options, timeZone });
    } catch {
      format = new Intl.DateTimeFormat('en-US', options);
    }
    FORMATS.set(timeZone, format);
  }
  return format;
};

export const zonedParts = (at: number, timeZone: string): ZonedParts => {
  const parts: Record<string, string> = {};
  for (const part of formatFor(timeZone).formatToParts(new Date(at))) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday ?? 'Sun'] ?? 0,
  };
};

/** The instant at which the zone's clock reads the given wall time. */
export const zonedToUtc = (year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number => {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (instant: number) => {
    const parts = zonedParts(instant, timeZone);
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - instant;
  };
  const first = offsetAt(guess);
  const result = guess - first;
  const second = offsetAt(result);
  return second === first ? result : guess - second;
};

export const parseClock = (value: string): { hour: number; minute: number } | null => {
  const match = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
};

/** The next instant after `after` when the local clock reads `hh:mm`, optionally on certain weekdays only. */
export const nextLocalTime = (after: number, clock: { hour: number; minute: number }, timeZone: string, weekdays?: ReadonlySet<number>): number => {
  for (let offset = 0; offset <= 8; offset += 1) {
    const day = zonedParts(after + offset * 86_400_000, timeZone);
    const candidate = zonedToUtc(day.year, day.month, day.day, clock.hour, clock.minute, timeZone);
    if (candidate <= after) continue;
    if (weekdays && !weekdays.has(zonedParts(candidate, timeZone).weekday)) continue;
    return candidate;
  }
  return after + 86_400_000;
};

/** The next instant after `after` when the local clock shows `minute` past an hour. */
export const nextLocalMinute = (after: number, minute: number, timeZone: string): number => {
  const start = Math.floor(after / 60_000) * 60_000 + 60_000;
  for (let step = 0; step <= 61; step += 1) {
    const candidate = start + step * 60_000;
    if (zonedParts(candidate, timeZone).minute === minute) return candidate;
  }
  return after + 3_600_000;
};

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const parseWeekday = (value: unknown): number | null => {
  if (typeof value === 'number' && value >= 0 && value <= 6) return Math.floor(value);
  if (typeof value !== 'string') return null;
  const index = DAY_NAMES.indexOf(value.trim().slice(0, 3).toLowerCase());
  return index === -1 ? null : index;
};
