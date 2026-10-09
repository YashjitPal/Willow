/**
 * Willow's breakpoints in the agents' page. Willow lays itself out by its window's width, rail
 * included, which this page's frame is narrower than, so its page sends that width
 * (HarnessView's `viewport`). The tiers it falls in go on the root for the styles
 * (`html[data-willow-compact]` in willow/*.css) and to the layout's switches (the sidebar's
 * drawer, the side panel's overlay), so both change at the sizes Willow's own pages do: 960px
 * and below (its compact layout), 769–960px, 768px and below, 600px and below, and 720px and
 * 480px where a page of Willow's stacks or drops a part.
 */
import { useSyncExternalStore } from "react";

const TIERS: ReadonlyArray<readonly [attribute: string, applies: (width: number) => boolean]> = [
  ["data-willow-compact", (width) => width <= 960],
  ["data-willow-tablet", (width) => width > 768 && width <= 960],
  ["data-willow-phone", (width) => width <= 768],
  ["data-willow-max-720", (width) => width <= 720],
  ["data-willow-small", (width) => width <= 600],
  ["data-willow-max-480", (width) => width <= 480],
];

/** Willow's compact layout: its sidebar is a drawer and its side panels cover the page. */
const COMPACT_MAX = 960;

let viewportWidth: number | null = null;
const listeners = new Set<() => void>();

export function setWillowViewport(width: unknown): void {
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) return;
  if (width === viewportWidth) return;
  viewportWidth = width;
  const root = document.documentElement;
  root.style.setProperty("--willow-viewport-width", `${width}px`);
  for (const [attribute, applies] of TIERS) root.toggleAttribute(attribute, applies(width));
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Whether Willow is in its compact layout, or null outside Willow (a browser, a phone). */
export function useWillowCompact(): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => (viewportWidth === null ? null : viewportWidth <= COMPACT_MAX),
    () => null,
  );
}
