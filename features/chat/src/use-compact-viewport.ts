import { useSyncExternalStore } from 'react';

/**
 * Gemini lays its chat out for phones and tablets at 960px and below: the
 * `chat-app.mobile` class and its `max-width: 959.98px` rules. Measured at 390
 * and 800, everything in the thread that differs from desktop switches here.
 */
export const COMPACT_VIEWPORT_QUERY = '(max-width: 960px)';

export const isCompactViewport = () =>
  typeof window !== 'undefined' && window.matchMedia(COMPACT_VIEWPORT_QUERY).matches;

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(COMPACT_VIEWPORT_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

export function useCompactViewport(): boolean {
  return useSyncExternalStore(subscribe, isCompactViewport, () => false);
}
