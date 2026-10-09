// What Flow's character page decides before it draws: whether the window is a tablet or smaller,
// and whether history is open. History starts hidden until Show history opens it, and the choice
// is remembered (Flow keeps it on the account, Willow in this browser). Flow itself opens it for an
// account that has never chosen; hidden is the state the user's own Flow account opens in. On a
// tablet or smaller it always starts closed, opens over the page instead of beside it, and the
// choice isn't remembered.
import React from 'react';

/** Flow's phone and tablet breakpoints together: under 840px portrait, under 1280px landscape. */
export const TABLET_OR_SMALLER_QUERY = [
  '(max-width: 599.98px) and (orientation: portrait)',
  '(max-width: 959.98px) and (orientation: landscape)',
  '(min-width: 600px) and (max-width: 839.98px) and (orientation: portrait)',
  '(min-width: 960px) and (max-width: 1279.98px) and (orientation: landscape)',
].join(', ');

const HISTORY_OPEN_KEY = 'willow-media-character-history-open';

export function readHistoryOpen(): boolean {
  try {
    return localStorage.getItem(HISTORY_OPEN_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeHistoryOpen(open: boolean): void {
  try {
    localStorage.setItem(HISTORY_OPEN_KEY, String(open));
  } catch {
    // Storage unavailable: the choice lasts as long as the page.
  }
}

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(TABLET_OR_SMALLER_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

export function useTabletOrSmaller(): boolean {
  return React.useSyncExternalStore(subscribe, () => window.matchMedia(TABLET_OR_SMALLER_QUERY).matches, () => false);
}
