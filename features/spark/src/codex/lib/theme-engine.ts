import { useSyncExternalStore } from 'react';

/**
 * The part of the Codex theme engine the ported Codex UI reads. Willow has no
 * reduced-motion setting of its own, so this follows the OS preference.
 */
const QUERY = '(prefers-reduced-motion: reduce)';

const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};

const prefersReducedMotion = () => window.matchMedia(QUERY).matches;

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
