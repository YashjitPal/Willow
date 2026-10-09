import { useId, useLayoutEffect } from 'react';
import { create } from 'zustand';

export type MainContentLayoutKind = 'default' | 'thread-edge-scroll' | 'full-bleed' | 'custom-titlebar';

interface MainContentLayoutEntry {
  id: string;
  layout: MainContentLayoutKind;
}

const useMainContentLayoutStore = create<{ entries: MainContentLayoutEntry[] }>(() => ({ entries: [] }));

/** `MainContentLayout`: how the routed page sits under the Spaces top bar; the last mounted one wins. */
export function MainContentLayout({ layout }: { layout: MainContentLayoutKind }) {
  const id = useId();
  useLayoutEffect(() => {
    useMainContentLayoutStore.setState((state) => ({ entries: [...state.entries.filter((entry) => entry.id !== id), { id, layout }] }));
    return () => useMainContentLayoutStore.setState((state) => ({ entries: state.entries.filter((entry) => entry.id !== id) }));
  }, [id, layout]);
  return null;
}

export function useMainContentLayout(): MainContentLayoutKind {
  return useMainContentLayoutStore((state) => state.entries.at(-1)?.layout ?? 'default');
}
