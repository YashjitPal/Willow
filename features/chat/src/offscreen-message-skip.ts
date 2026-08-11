/**
 * Skip layout for chat messages that are scrolled out of view.
 *
 * Measured on this thread (2026-08-11, forced synchronous layout in the user's
 * own Chrome): one width change over a 28-turn conversation costs ~13.5ms even
 * with every per-word span flattened away. The context panel animates width for
 * 300ms — roughly 18 frames — so the thread cannot hit frame rate no matter how
 * cheap each node is made. The work has to stop happening, not get cheaper.
 *
 * `content-visibility: auto` is the mechanism: Chrome skips style, layout and
 * paint for a subtree it has decided is off-screen. The catch is that a skipped
 * subtree still has to report a height, and Chrome uses `contain-intrinsic-size`
 * for it. Get that number wrong and every scroll offset below it is wrong —
 * which matters more here than in most apps, because ChatView positions its
 * scroll jumps off `offsetTop`, the running sum of preceding siblings' heights.
 *
 * So the number is never invented. `contain-intrinsic-size: auto <fallback>`
 * tells Chrome to remember the height from the last time the element really
 * rendered and use that; the fallback only applies to an element that has never
 * been on screen once. This hook additionally records each height into a session
 * cache so the fallback for a *remounted* message (chat reopened, chunked reveal
 * re-running) is its own last real height rather than a generic guess.
 *
 * Deliberately not applied to:
 *   - the last assistant turn, which carries the response reserve and is the
 *     element the streaming path measures every frame
 *   - anything currently generating
 *   - browsers without support, where the whole declaration is inert anyway
 */

import { useCallback, useEffect, useRef } from 'react';

/** Chrome ≥85, Edge, Opera. Safari and Firefox simply keep today's behaviour. */
export const supportsContentVisibility = (): boolean =>
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('content-visibility', 'auto') &&
  // `auto` inside contain-intrinsic-size is a separate, later addition, and it
  // is the half that makes this safe. Without it a skipped element would report
  // the static fallback forever and scroll offsets would drift.
  CSS.supports('contain-intrinsic-size', 'auto 100px');

/**
 * Heights are keyed by message id and survive unmount, because the chunked
 * reveal and chat reopen both remount messages that have already been measured
 * once. Module-level rather than per-instance: ChatView remounts on
 * `key={chatResetKey}` and the measurements stay valid across that.
 */
const heightCache = new Map<string, number>();

/**
 * A conservative stand-in for a message that has genuinely never rendered.
 *
 * Only reachable before the first measurement lands — one frame, since the
 * observer below fires on mount. Chosen at roughly one short reply rather than
 * an average, because under-guessing makes the scrollbar grow as content
 * resolves, which reads as content loading; over-guessing makes it shrink,
 * which reads as the page collapsing under you.
 */
const FALLBACK_HEIGHT = 240;

export interface MessageSkipStyle {
  contentVisibility?: 'auto';
  containIntrinsicSize?: string;
}

/**
 * The style for one message, given whatever height was last recorded for it.
 *
 * Pure and exported so the decision can be tested directly: the failure this
 * guards against — a wrong intrinsic height corrupting every `offsetTop` below
 * it — is invisible in review and only reproduces in a long thread.
 */
export const skipStyleFor = (
  remembered: number | undefined,
  enabled: boolean,
): MessageSkipStyle => {
  if (!enabled) return {};
  // `auto` first: Chrome prefers its own remembered size and falls back to the
  // length only for an element it has never rendered. A non-finite or
  // non-positive cached value would produce invalid CSS that drops the whole
  // declaration, so it is treated as "never measured".
  const usable = typeof remembered === 'number' && Number.isFinite(remembered) && remembered > 0;
  return {
    contentVisibility: 'auto',
    containIntrinsicSize: `auto ${usable ? Math.round(remembered as number) : FALLBACK_HEIGHT}px`,
  };
};

/**
 * Records real heights and hands back the style that lets Chrome skip a message.
 *
 * `measureRef` must be attached to the same element the style is applied to —
 * the intrinsic size describes that element's own box.
 */
export const useOffscreenMessageSkip = () => {
  const observerRef = useRef<ResizeObserver | null>(null);
  const observedRef = useRef(new Map<Element, string>());

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const id = observedRef.current.get(entry.target);
        if (!id) continue;
        // borderBoxSize is the box `contain-intrinsic-size` describes. A skipped
        // element reports its *intrinsic* size here, not a real measurement, so
        // writing that back would freeze the cached value at whatever it already
        // was — harmless, but pointless. Height 0 means detached; never cache it.
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        if (height > 0) heightCache.set(id, Math.round(height));
      }
    });
    observerRef.current = observer;
    return () => {
      observer.disconnect();
      observerRef.current = null;
      observedRef.current.clear();
    };
  }, []);

  const measureRef = useCallback((id: string) => (element: HTMLDivElement | null) => {
    const observer = observerRef.current;
    const observed = observedRef.current;
    if (!observer) return;
    // React calls a ref callback with null on unmount, and with the element on
    // mount; re-observing the same node twice is a no-op but tracking it twice
    // would leak the map.
    for (const [node, nodeId] of observed) {
      if (nodeId === id && node !== element) {
        observer.unobserve(node);
        observed.delete(node);
      }
    }
    if (element) {
      observed.set(element, id);
      observer.observe(element);
    }
  }, []);

  const skipStyle = useCallback(
    (id: string, enabled: boolean): MessageSkipStyle => skipStyleFor(heightCache.get(id), enabled),
    [],
  );

  return { measureRef, skipStyle };
};

/** Test seam — the cache is module state and would leak between cases. */
export const __resetMessageHeightCache = () => heightCache.clear();
export const __messageHeightCache = heightCache;
