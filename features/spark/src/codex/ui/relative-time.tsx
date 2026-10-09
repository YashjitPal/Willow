import { useSyncExternalStore } from "react";
import { useIntl } from "react-intl";

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;

let now = new Date();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer == null) {
    now = new Date();
    timer = setInterval(() => {
      now = new Date();
      listeners.forEach((notify) => notify());
    }, 60_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Wall clock shared by every subscriber, refreshed once a minute. */
export function useNow() {
  return useSyncExternalStore(subscribe, () => now);
}

/** `uX` (`doo`): time until `dateString` ("in 5 minutes", "in 2 days"); past times read "now". */
export function RelativeTime({ dateString }: { dateString: string }) {
  const intl = useIntl();
  const current = useNow();
  const minutes = -Math.floor((current.getTime() - new Date(dateString).getTime()) / 60_000);
  if (minutes <= 0) return <>{intl.formatRelativeTime(0, "second", { numeric: "auto" })}</>;
  if (minutes < MINUTES_PER_HOUR) return <>{intl.formatRelativeTime(minutes, "minute", { numeric: "always" })}</>;
  const hours = Math.ceil(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return <>{intl.formatRelativeTime(hours, "hour", { numeric: "always" })}</>;
  const days = Math.ceil(hours / HOURS_PER_DAY);
  if (days < DAYS_PER_WEEK) return <>{intl.formatRelativeTime(days, "day", { numeric: "always" })}</>;
  return <>{intl.formatRelativeTime(Math.ceil(days / DAYS_PER_WEEK), "week", { numeric: "always" })}</>;
}
