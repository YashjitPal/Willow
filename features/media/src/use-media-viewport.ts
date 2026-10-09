import { useEffect, useSyncExternalStore } from 'react';
import { COMPACT_VIEWPORT_QUERY } from '@willow/chat/use-compact-viewport';

/**
 * Media's three layouts. At Willow's compact width (960px and below) the rest of the app swaps in
 * its narrow layout, and so does Media; Media splits it again at 600px, where a phone held upright
 * ends: below it the rail is a drawer and every panel takes the screen, above it a tablet keeps an
 * icon rail. Above 960px is the desktop layout, which none of the narrow rules may move: they live
 * in `media-responsive.css`'s max-width blocks, and the components switch on this value.
 */
export const PHONE_VIEWPORT_QUERY = '(max-width: 600px)';

export type MediaViewport = 'phone' | 'tablet' | 'desktop';

export const mediaViewportNow = (): MediaViewport => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop';
  if (window.matchMedia(PHONE_VIEWPORT_QUERY).matches) return 'phone';
  return window.matchMedia(COMPACT_VIEWPORT_QUERY).matches ? 'tablet' : 'desktop';
};

const subscribe = (onChange: () => void) => {
  const queries = [PHONE_VIEWPORT_QUERY, COMPACT_VIEWPORT_QUERY].map((query) => window.matchMedia(query));
  for (const query of queries) query.addEventListener('change', onChange);
  return () => {
    for (const query of queries) query.removeEventListener('change', onChange);
  };
};

export function useMediaViewport(): MediaViewport {
  return useSyncExternalStore(subscribe, mediaViewportNow, () => 'desktop');
}

/**
 * A screen too short to stack a picture over its tools: a phone on its side. The editors scroll
 * there instead (editor-responsive.css) and the gallery's rows stay a phone's.
 */
export const SHORT_VIEWPORT_QUERY = '(max-height: 500px)';

const shortViewportNow = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(SHORT_VIEWPORT_QUERY).matches;

const subscribeShort = (onChange: () => void) => {
  const query = window.matchMedia(SHORT_VIEWPORT_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

export function useShortViewport(): boolean {
  return useSyncExternalStore(subscribeShort, shortViewportNow, () => false);
}

/**
 * Whether the rail opens as a drawer, from a menu button, instead of standing as the icon column:
 * on a phone, upright or on its side. A phone on its side has a tablet's width but not the height
 * for the column, whose last rows (Uploads, Tools, Trash) would fall off the bottom.
 */
export function useRailDrawer(): boolean {
  const viewport = useMediaViewport();
  const short = useShortViewport();
  return viewport === 'phone' || (short && viewport === 'tablet');
}

/** A screen worked by touch, whatever its width: nothing hovers, and a finger drags to scroll. */
export const TOUCH_SCREEN_QUERY = '(hover: none)';

const touchScreenNow = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(TOUCH_SCREEN_QUERY).matches;

const subscribeTouch = (onChange: () => void) => {
  const query = window.matchMedia(TOUCH_SCREEN_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

export function useTouchScreen(): boolean {
  return useSyncExternalStore(subscribeTouch, touchScreenNow, () => false);
}

export const KEYBOARD_INSET_PROPERTY = '--media-keyboard-inset';

/**
 * How much of the window an on-screen keyboard covers, published on <html> as
 * `--media-keyboard-inset` for the floating composer to sit above. Phones and tablets lay the
 * keyboard over the page rather than shrinking it, so a composer pinned to the bottom of the
 * window would otherwise end up underneath. A pinch zoom also shrinks the visual viewport, so
 * nothing is published while zoomed.
 */
export function useKeyboardInset(enabled: boolean): void {
  useEffect(() => {
    const visual = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!enabled || !visual) return undefined;
    const root = document.documentElement;
    const update = () => {
      const covered = visual.scale > 1.01 ? 0 : window.innerHeight - visual.height - visual.offsetTop;
      root.style.setProperty(KEYBOARD_INSET_PROPERTY, `${Math.max(0, Math.round(covered))}px`);
    };
    update();
    visual.addEventListener('resize', update);
    visual.addEventListener('scroll', update);
    return () => {
      visual.removeEventListener('resize', update);
      visual.removeEventListener('scroll', update);
      root.style.removeProperty(KEYBOARD_INSET_PROPERTY);
    };
  }, [enabled]);
}
