/**
 * The side panel's row when it runs short of room. The browser's bar (PreviewChromeRow) folds its
 * buttons into its "More" menu one at a time, in FOLD_ORDER, and the panel's terminal button,
 * beside the bar in Willow's desktop app, is one of them: PanelLayoutControls offers its toggle
 * here and hides the button while it is folded. The panel's own toggle, at the far right, never
 * folds.
 */
import { createContext, useSyncExternalStore } from "react";

export const FOLD_ORDER = ["pictureInPicture", "terminal", "annotate", "screenshot"] as const;
export type Foldable = (typeof FOLD_ORDER)[number];

/** A folded button as a row of the bar's "More" menu (PreviewMoreMenu), named for what it will do. */
export interface FoldedAction {
  readonly key: Foldable;
  readonly label: string;
  readonly disabled: boolean;
  readonly onSelect: () => void;
}

export const FoldedActions = createContext<readonly FoldedAction[]>([]);

export interface OfferedTerminal {
  readonly open: boolean;
  readonly available: boolean;
  readonly shortcutLabel: string | null;
  readonly toggle: () => void;
}

let terminalFolded = false;
let offered: OfferedTerminal | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const emit = () => {
  for (const listener of listeners) listener();
};

export function foldTerminal(folded: boolean) {
  if (terminalFolded === folded) return;
  terminalFolded = folded;
  emit();
}

export function useTerminalFolded(): boolean {
  return useSyncExternalStore(subscribe, () => terminalFolded);
}

export function offerTerminal(terminal: OfferedTerminal | null) {
  offered = terminal;
  emit();
}

export function useOfferedTerminal(): OfferedTerminal | null {
  return useSyncExternalStore(subscribe, () => offered);
}
