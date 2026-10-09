import { createContext, useContext } from "react";

export interface OverlayOwner {
  id: string;
  /** Called while a nested menu is open; the returned cleanup runs when it closes. */
  registerOpen?: () => (() => void) | void;
}

/** Identifies the overlay that owns nested floating content (`data-overlay-owner`). */
export const OverlayOwnerContext = createContext<OverlayOwner | undefined>(undefined);

/** Zoom factor of the Codex window; overlays divide viewport units by it. */
export const WindowZoomContext = createContext(1);

export function useWindowZoom() {
  return useContext(WindowZoomContext);
}

export const DISMISS_TOOLTIPS_EVENT = "codex:dismiss-tooltips";

export function dismissTooltips() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DISMISS_TOOLTIPS_EVENT));
}
