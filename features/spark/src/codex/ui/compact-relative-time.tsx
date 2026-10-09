import { useIntl } from "react-intl";
import { useNow } from "./relative-time";

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;

export type RelativeTimeUnit = "minute" | "hour" | "day" | "week" | "month" | "year";

/** `roo` (`fX`): how long ago `dateString` was; days count calendar days unless `dayBasis` is `elapsed`. */
export function relativeTimeParts(dateString: string, now: Date, dayBasis: "calendar" | "elapsed" = "calendar"): { unit: RelativeTimeUnit; value: number } {
  const date = new Date(dateString);
  const minutes = Math.max(1, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes < MINUTES_PER_HOUR) return { unit: "minute", value: minutes };
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return { unit: "hour", value: hours };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days =
    dayBasis === "elapsed" ? Math.floor(hours / HOURS_PER_DAY) : Math.max(1, Math.round((today.getTime() - day.getTime()) / 86_400_000));
  if (days < DAYS_PER_WEEK) return { unit: "day", value: days };
  if (days < DAYS_PER_MONTH) return { unit: "week", value: Math.floor(days / DAYS_PER_WEEK) };
  if (days < DAYS_PER_YEAR) return { unit: "month", value: Math.floor(days / DAYS_PER_MONTH) };
  return { unit: "year", value: Math.floor(days / DAYS_PER_YEAR) };
}

export interface CompactRelativeTimeProps {
  dateString: string;
  format?: "compact" | "relative";
  dayBasis?: "calendar" | "elapsed";
}

/** `lX` (`F10`): "5m", "3h", "2d"… or, with `format="relative"`, the narrow localized form. */
export function CompactRelativeTime({ dateString, format = "compact", dayBasis = "calendar" }: CompactRelativeTimeProps) {
  const intl = useIntl();
  const now = useNow();
  const { unit, value } = relativeTimeParts(dateString, now, dayBasis);
  if (format === "relative") return <>{intl.formatRelativeTime(-value, unit, { numeric: "always", style: "narrow" })}</>;
  switch (unit) {
    case "minute":
      return (
        <>
          {intl.formatMessage(
            { id: "wham.formattedRelativeDateTime.compactMinutesAgo", defaultMessage: "{value}m", description: "Compact minutes-ago format" },
            { value },
          )}
        </>
      );
    case "hour":
      return (
        <>
          {intl.formatMessage(
            { id: "wham.formattedRelativeDateTime.compactHoursAgo", defaultMessage: "{value}h", description: "Compact hours-ago format" },
            { value },
          )}
        </>
      );
    case "day":
      return (
        <>
          {intl.formatMessage(
            { id: "wham.formattedRelativeDateTime.compactDaysAgo", defaultMessage: "{value}d", description: "Compact days-ago format" },
            { value },
          )}
        </>
      );
    case "week":
      return (
        <>
          {intl.formatMessage(
            { id: "wham.formattedRelativeDateTime.compactWeeksAgo", defaultMessage: "{value}w", description: "Compact weeks-ago format" },
            { value },
          )}
        </>
      );
    case "month":
      return (
        <>
          {intl.formatMessage(
            { id: "wham.formattedRelativeDateTime.compactMonthsAgo", defaultMessage: "{value}mo", description: "Compact months-ago format" },
            { value },
          )}
        </>
      );
    case "year":
      return (
        <>
          {intl.formatMessage(
            { id: "wham.formattedRelativeDateTime.compactYearsAgo", defaultMessage: "{value}y", description: "Compact years-ago format" },
            { value },
          )}
        </>
      );
  }
}
