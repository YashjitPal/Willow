import { useEffect, type ReactNode } from 'react';
import { create } from 'zustand';

/**
 * Codex's shell header slot (`HMt`): a Space page puts its header there while
 * mounted. Willow's Spaces top bar (`SpacesTopBar`) renders it.
 */
interface SpacesHeaderStore {
  pageHeader: ReactNode;
}

export const useSpacesHeaderStore = create<SpacesHeaderStore>(() => ({ pageHeader: null }));

export function useAppShellHeader({ pageHeader }: { pageHeader?: ReactNode }) {
  useEffect(() => {
    if (pageHeader === undefined) return;
    useSpacesHeaderStore.setState({ pageHeader });
    return () => useSpacesHeaderStore.setState({ pageHeader: null });
  }, [pageHeader]);
}
