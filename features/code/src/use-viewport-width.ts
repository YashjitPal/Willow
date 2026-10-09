import { useSyncExternalStore } from 'react';

const subscribe = (onChange: () => void) => {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
};

const read = () => (typeof window === 'undefined' ? 1024 : window.innerWidth);

/** The window's width, re-read on resize. Below 961px the workbench sidebar is the whole screen wide. */
export function useViewportWidth(): number {
  return useSyncExternalStore(subscribe, read, () => 1024);
}
