// ──────────────────────────────────────────────────────────────────────────────
// `--dpr` on `<html>`: the device pixel ratio, readable from CSS.
//
// WHY THIS EXISTS. A hairline drawn as a filled box is rasterized from its
// snapped edges, so a `width: 1px` background lands on ONE device pixel or
// smears across TWO depending on where its box happens to fall — measured at
// dpr 1.25, which is what this machine runs. Two rails declared identically then
// render at visibly different weights, and which one you get changes with the
// window width. A BORDER width, by contrast, is snapped to whole device pixels
// before paint, so `border-left` always paints the same amount of ink at every
// sub-pixel phase.
//
// That fixes consistency but not weight: a border can only be a whole number of
// device pixels, and CSS alone cannot ask for "two of them" — `2px` means two
// CSS pixels, which is 2.5 device pixels here. Dividing by the ratio is the
// missing half, and the ratio is the one thing CSS cannot see. Hence this file:
//
//   border-left: calc(2px / var(--dpr, 1)) solid …   →  exactly 2 device pixels
//
// The fallback of `1` is deliberate: unpublished, the expression degrades to a
// plain `2px` border rather than collapsing to zero.
// ──────────────────────────────────────────────────────────────────────────────

const publish = (): number => {
  const ratio = window.devicePixelRatio || 1;
  document.documentElement.style.setProperty('--dpr', String(ratio));
  return ratio;
};

/**
 * Publishes `--dpr` and keeps it current. Returns a teardown function.
 *
 * The ratio changes on browser zoom and when the window is dragged to a monitor
 * with a different scale factor. There is no `devicepixelratiochange` event, so
 * the idiomatic trick is a media query pinned to the value we just published —
 * it flips the moment the browser leaves it, at which point we re-arm around the
 * new one. `resize` is belt and braces: Chrome fires it on zoom, and it covers
 * any engine whose `resolution` feature does not match an exact fractional dppx.
 */
export const startDevicePixelRatioSync = (): (() => void) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  let query: MediaQueryList | null = null;
  let stopped = false;

  const arm = () => {
    if (stopped) return;
    const ratio = publish();
    query?.removeEventListener('change', arm);
    query = window.matchMedia(`(resolution: ${ratio}dppx)`);
    query.addEventListener('change', arm);
  };

  arm();
  window.addEventListener('resize', arm);

  return () => {
    stopped = true;
    query?.removeEventListener('change', arm);
    query = null;
    window.removeEventListener('resize', arm);
  };
};
