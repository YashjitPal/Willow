/**
 * Workspace colour -> home-glow accent.
 *
 * The glow behind the zero-state prompt box is a radial gradient from the
 * surface out to one accent colour. This module holds that accent, per
 * workspace swatch.
 *
 * ── what was measured ──────────────────────────────────────────────────────
 * Gemini's rule, read off the live app's authored cascade (not eyeballed, and
 * not `getComputedStyle`, which would have resolved the token away):
 *
 *   .show-lm-background::before {
 *     background: radial-gradient(ellipse 100% 100% at center 8%,
 *       var(--lumi-sys-color--surface) 0,
 *       var(--lumi-sys-color--surface-accent) 50%);
 *     filter: blur(125px);
 *   }
 *   :where(.dark-theme) .show-lm-background::before { filter: blur(100px); }
 *
 * So the accent stop is exactly one token: `--lumi-sys-color--surface-accent`.
 * In dark theme it resolves to `#14204f` — confirmed three independent ways:
 * the authored declaration under `:where(.theme-host):where(.dark-theme)`, the
 * value resolved on both `body` and the glow host, and the host's own
 * `::before` re-resolved with `is-temporary-chat` lifted, which painted
 * `rgb(20, 32, 79)`. That last probe also showed `backgroundImage` is the ONLY
 * property that differs between normal and temporary chat — the box, blur,
 * radius and grow animation are shared. Willow already matches all of those.
 *
 * ── why green is pinned rather than derived ────────────────────────────────
 * Green is the default and already ships as `rgb(6, 78, 59)`. The requirement
 * is that switching back to green restores what is on screen today, so it is
 * held fixed. It is not the workspace swatch darkened by any rule: measured
 * against its swatch it gives lightness 0.699 / chroma 0.945 / hue +16.2deg,
 * where Gemini's blue pair gives 0.424 / 0.467 / +9.0deg. Those disagree by
 * 24-34%, which is the evidence that Willow's green was hand-picked (it is
 * Tailwind emerald-900) and that no single transform describes both. Pretending
 * one existed would have moved either the green or the blue off its target.
 *
 * ── where pink, yellow and orange come from ────────────────────────────────
 * Gemini only gives us one accent, because Gemini only has one. The other three
 * swatches have no upstream to copy, so rather than inventing colours they are
 * put through the transform measured from the one real pair we do have —
 * `#3b82f6` -> `#14204f` in OKLCh: lightness x0.4242, chroma x0.4669, hue
 * +9.04deg. Applied back to blue that transform reproduces `#14204f` at
 * dE = 0.0, so it is the Gemini relationship exactly, carried to hues Gemini
 * never had to answer for.
 *
 * OKLCh because it is perceptually uniform: the same three numbers mean the
 * same visual move at every hue, where per-channel sRGB scaling would drift.
 * `oklchToRgb` gamut-maps by reducing chroma, so nothing clips to a hue shift.
 *
 * `apps/studio/test/home-glow-accent.test.mjs` re-runs the derivation and asserts
 * these constants equal its output, so the baked values cannot drift from the
 * measurement.
 */

import {
  WORKSPACE_COLOR_HEX,
  hexToRgb,
  oklchToRgb,
  rgbToOklch,
  type WorkspaceColorName,
} from '@willow/chat/voice-orb/orb-palette';

export type { WorkspaceColorName };

/** Gemini's `--lumi-sys-color--surface-accent`, dark theme. */
export const GEMINI_GLOW_ACCENT_HEX = '#14204f';

/** The glow Willow ships today, and the default when no workspace colour is set. */
export const DEFAULT_GLOW_ACCENT = 'rgb(6, 78, 59)';

/**
 * The measured OKLCh transform from a workspace swatch to its glow accent,
 * taken from the single Gemini pair `#3b82f6` -> `#14204f`.
 */
export const GLOW_ACCENT_TRANSFORM = {
  lightnessRatio: 0.424245154339543,
  chromaRatio: 0.46688940886964236,
  hueShiftDeg: 9.038231999938716,
} as const;

/** Apply the measured transform to one swatch. Returns `rgb(r, g, b)`. */
export const deriveGlowAccent = (hex: string): string => {
  const [L, C, h] = rgbToOklch(hexToRgb(hex));
  const { lightnessRatio, chromaRatio, hueShiftDeg } = GLOW_ACCENT_TRANSFORM;
  const rgb = oklchToRgb([
    L * lightnessRatio,
    C * chromaRatio,
    (h + hueShiftDeg + 360) % 360,
  ]);
  return `rgb(${rgb.map((c) => Math.round(c * 255)).join(', ')})`;
};

/**
 * The accent stop of `.willow-gemini-home-glow::before`, per workspace colour.
 *
 * Blue is Gemini's measured token. Green is the shipped default, held fixed.
 * The rest are `deriveGlowAccent` of their swatch, baked so the gradient is a
 * static string rather than colour maths on every render.
 */
export const HOME_GLOW_ACCENT = {
  green: DEFAULT_GLOW_ACCENT,
  blue: 'rgb(20, 32, 79)',
  pink: 'rgb(76, 9, 35)',
  yellow: 'rgb(66, 54, 0)',
  orange: 'rgb(72, 34, 0)',
} as const satisfies Record<WorkspaceColorName, string>;

/**
 * Resolve a workspace colour to its glow accent, tolerating `undefined` and any
 * value that is not a known swatch — an unrecognised profile value falls back to
 * the default green rather than blanking the glow.
 */
export const homeGlowAccent = (color: string | null | undefined): string =>
  (color && color in HOME_GLOW_ACCENT
    ? HOME_GLOW_ACCENT[color as WorkspaceColorName]
    : DEFAULT_GLOW_ACCENT);

/** The swatch hexes the accents were derived from, re-exported for the test. */
export { WORKSPACE_COLOR_HEX };
