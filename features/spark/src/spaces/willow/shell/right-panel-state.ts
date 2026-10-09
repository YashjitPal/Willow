import { createElement, type ComponentType, type ReactNode } from 'react';
import type { MessageDescriptor } from 'react-intl';
import { create } from 'zustand';

/**
 * Codex's right panel (`right-panel-state`), as far as Spaces uses it: tabs
 * that open beside the page (a Page, a library file) and the outlet a page can
 * fill (a file preview). Willow's Spaces side sheet (`SpacesSidePanel`) shows it.
 */
export interface RightPanelTabPanelProps {
  /** The tab is the active one and the panel shows its tabs. */
  isVisible: boolean;
  onClose: () => void;
}

export interface RightPanelContextMenuItem {
  id: string;
  message: MessageDescriptor;
  onSelect: () => void;
}

export interface RightPanelTabType<P extends object> {
  kind: string;
  Component: ComponentType<P & RightPanelTabPanelProps>;
  getId: (props: P) => string;
  getIcon?: (props: P) => ReactNode;
  getTitleContent?: (props: P) => ReactNode;
  getContextMenuItems?: (props: P) => RightPanelContextMenuItem[];
  /** Runs when the tab is closed from the panel (close button, Escape or the store). */
  onClose?: (props: P) => void;
  closeOnEscape?: boolean;
  allowFullWidth?: boolean;
}

export function defineRightPanelTabType<P extends object>(
  kind: string,
  Component: ComponentType<P & RightPanelTabPanelProps>,
  options: Omit<RightPanelTabType<P>, 'kind' | 'Component'>,
): RightPanelTabType<P> {
  return { ...options, kind, Component };
}

export interface RightPanelTab {
  tabId: string;
  kind: string;
  title: string;
  titleContent: ReactNode;
  tooltip: string | undefined;
  icon: ReactNode;
  closeOnEscape: boolean;
  allowFullWidth: boolean;
  render: (panel: RightPanelTabPanelProps) => ReactNode;
  getContextMenuItems: (() => RightPanelContextMenuItem[]) | undefined;
  onClose: (() => void) | undefined;
}

export interface RightPanelState {
  isOpen: boolean;
  isFullWidth: boolean;
  tabs: RightPanelTab[];
  activeTabId: string | null;
}

export const useRightPanelStore = create<RightPanelState>(() => ({ isOpen: false, isFullWidth: false, tabs: [], activeTabId: null }));

export interface RightPanelOutletState {
  /** What the panel shows while no tab is active (`RightPanelOutlet`). */
  detail: ReactNode;
}

export const useRightPanelOutletStore = create<RightPanelOutletState>(() => ({ detail: null }));

export function setRightPanelOpen(open: boolean, _options: { animate?: boolean } = {}) {
  useRightPanelStore.setState(open ? { isOpen: true } : { isOpen: false, isFullWidth: false });
}

export function setRightPanelFullWidth(fullWidth: boolean) {
  const { tabs, activeTabId } = useRightPanelStore.getState();
  if (fullWidth && tabs.find((tab) => tab.tabId === activeTabId)?.allowFullWidth === false) return;
  useRightPanelStore.setState({ isFullWidth: fullWidth });
}

export interface OpenRightPanelTabOptions {
  title: string;
  titleContent?: ReactNode;
  tooltip?: string;
  icon?: ReactNode;
  revealAndFocus?: boolean;
}

/** `openRightPanelTab`: opens the tab, or brings back the one with the same id. */
export function openRightPanelTab<P extends object>(type: RightPanelTabType<P>, props: P, { title, titleContent, tooltip, icon, revealAndFocus = true }: OpenRightPanelTabOptions): string {
  const tabId = type.getId(props);
  const { Component, getContextMenuItems, onClose } = type;
  const tab: RightPanelTab = {
    tabId,
    kind: type.kind,
    title,
    titleContent: titleContent ?? type.getTitleContent?.(props),
    tooltip,
    icon: icon ?? type.getIcon?.(props) ?? null,
    closeOnEscape: type.closeOnEscape ?? false,
    allowFullWidth: type.allowFullWidth ?? true,
    render: (panel) => createElement(Component, { ...props, ...panel }),
    getContextMenuItems: getContextMenuItems == null ? undefined : () => getContextMenuItems(props),
    onClose: onClose == null ? undefined : () => onClose(props),
  };
  useRightPanelStore.setState((state) => {
    const exists = state.tabs.some((current) => current.tabId === tabId);
    const tabs = exists ? state.tabs.map((current) => (current.tabId === tabId ? tab : current)) : [...state.tabs, tab];
    return revealAndFocus || state.activeTabId == null ? { tabs, activeTabId: tabId, isOpen: true } : { tabs };
  });
  return tabId;
}

export function updateRightPanelTab(tabId: string, patch: Partial<Pick<RightPanelTab, 'title' | 'titleContent' | 'tooltip' | 'icon'>>) {
  useRightPanelStore.setState((state) => ({ tabs: state.tabs.map((tab) => (tab.tabId === tabId ? { ...tab, ...patch } : tab)) }));
}

export function activateRightPanelTab(tabId: string) {
  useRightPanelStore.setState({ activeTabId: tabId, isOpen: true });
}

export function closeRightPanelTab(tabId: string) {
  const { tabs, activeTabId } = useRightPanelStore.getState();
  const index = tabs.findIndex((tab) => tab.tabId === tabId);
  if (index < 0) return;
  tabs[index].onClose?.();
  const remaining = tabs.filter((tab) => tab.tabId !== tabId);
  const nextActive = activeTabId === tabId ? (remaining[Math.min(index, remaining.length - 1)]?.tabId ?? null) : activeTabId;
  const hasDetail = useRightPanelOutletStore.getState().detail != null;
  useRightPanelStore.setState({
    tabs: remaining,
    activeTabId: nextActive,
    ...(remaining.length === 0 && !hasDetail ? { isOpen: false, isFullWidth: false } : null),
  });
}

/** Clears the panel when Spaces unmounts, so a stale tab cannot reopen over another page. */
export function resetRightPanel() {
  useRightPanelStore.setState({ isOpen: false, isFullWidth: false, tabs: [], activeTabId: null });
  useRightPanelOutletStore.setState({ detail: null });
}
