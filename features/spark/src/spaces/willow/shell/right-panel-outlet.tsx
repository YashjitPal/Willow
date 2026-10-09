import { useLayoutEffect, type ReactNode } from 'react';
import { useRightPanelOutletStore } from './right-panel-state';

export interface RightPanelOutletProps {
  children?: ReactNode;
  /** Codex keeps the content clear of the window controls; Willow's side sheet has none. */
  reserveTitlebarInset?: boolean;
}

/** `RightPanelOutlet`: what the side sheet shows while no tab is active, published while mounted. */
export function RightPanelOutlet({ children }: RightPanelOutletProps) {
  useLayoutEffect(() => {
    useRightPanelOutletStore.setState({ detail: children ?? null });
  }, [children]);
  useLayoutEffect(() => () => useRightPanelOutletStore.setState({ detail: null }), []);
  return null;
}
