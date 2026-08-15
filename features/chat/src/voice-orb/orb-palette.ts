/**
 * Workspace colour -> orb palette.
 *
 * The orb's colour is a four-slot palette in the interior shader (shadow, midLow,
 * midHigh, highlight), so "the difference between the workspace blue and the orb's
 * blue" is not one offset -- it is a per-slot transform. This module holds that
 * transform, measured from the single pair that already existed, and the derivation
 * that applies it to every other workspace swatch. `voice-orb-palette.test.mjs`
 * re-runs the derivation and asserts the GLSL constants equal its output, so the
 * baked shader values cannot drift from the measurement that produced them.
 *
 * ── what was measured ──────────────────────────────────────────────────────
 * The pair is workspace blue `#3b82f6` against the palette the orb renders today.
 * That palette is `materialDefaultPalette`, not `materialBluePalette`:
 * `PALETTE_INDEX_BY_NAME` sends `blue` to index 0, and the shader's switch resolves
 * 0 through its `default:` arm, leaving index 1 unreachable. So the blue-toned look
 * on screen now is the default palette, and that is what was measured.
 *
 * Work in OKLCh. It is perceptually uniform, so "the same difference" is the same
 * numbers; per-channel sRGB offsets would drift in appearance across hues.
 *
 * ── why lightness is a fraction of the headroom to white ───────────────────
 * The first attempt used an additive lightness offset, dL. It broke on contact with
 * the shader: green's midHigh came out `#e4e4e4` and yellow's highlight clipped to
 * pure white, collapsing into the midHigh slot and costing the orb a tone.
 *
 * All seven shipped palettes have pure `#ffffff` in the midHigh slot. Re-measured
 * as a headroom fraction -- t where L' = L + t*(1 - L) -- that slot is t = 1.000000
 * with standard deviation 0.000000 across all seven, and chroma ratio exactly 0. An
 * additive offset would have produced seven different values there. So the shader's
 * own constants say the lightness axis is a headroom fraction, and midHigh is its
 * endpoint: t = 1 lands on white for any base, reproducing the invariant by
 * construction rather than by luck. Nothing clips, because t <= 1 cannot overshoot.
 *
 * ── why the hue rotation is kept ───────────────────────────────────────────
 * The orb's blue is rotated +18.87 degrees off the workspace blue -- it reads as
 * periwinkle, not blue. Dropping the rotation moves today's orb from `#7d81ff` to
 * `#4b8fff` (dE 0.06, visible), which would change the appearance that had to be
 * preserved. Kept, it round-trips blue to dE 3.3e-8. It is also what "the same
 * difference for every colour" means literally: identical t, identical chroma
 * ratio, identical hue shift, per slot, for all five swatches.
 *
 * ── on the shipped green/yellow/pink/orange palettes ───────────────────────
 * The shader already ships palettes for those hues, and they are left untouched and
 * still reachable through `PALETTE_INDEX_BY_NAME`. They are not used for the
 * workspace colours because they do not stand in a common relationship to anything:
 * measured against their own shadow slot their midLow t spreads 0.27..0.62 and
 * their hue deltas -22.5..+32.8 degrees. They are hand-authored per hue, so there
 * is no upstream rule to extract -- which is why the one defined pair is the source.
 */

/** sRGB 0..1 -> linear-light. */
const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

/** Linear-light -> sRGB 0..1. */
const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

type Triple = readonly [number, number, number];

const linearToOklab = ([r, g, b]: Triple): Triple => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

const oklabToLinear = ([L, a, b]: Triple): Triple => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
};

const oklabToOklch = ([L, a, b]: Triple): Triple => [
  L,
  Math.hypot(a, b),
  ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360,
];

const oklchToOklab = ([L, C, h]: Triple): Triple => [
  L,
  C * Math.cos((h * Math.PI) / 180),
  C * Math.sin((h * Math.PI) / 180),
];

const isInGamut = ([r, g, b]: Triple): boolean =>
  [r, g, b].every((c) => c >= -1e-5 && c <= 1 + 1e-5);

/** `#rrggbb` -> sRGB 0..1. */
export const hexToRgb = (hex: string): Triple => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

export const rgbToOklch = (rgb: Triple): Triple =>
  oklabToOklch(linearToOklab(rgb.map(srgbToLinear) as unknown as Triple));

/**
 * OKLCh -> sRGB, gamut-mapped by reducing chroma.
 *
 * Clamping channels instead would shift hue, and a hue that moves per swatch is
 * exactly the thing this module exists to hold constant. Reducing chroma preserves
 * hue and lightness, which is what CSS Color 4 specifies for out-of-gamut colours.
 */
export const oklchToRgb = ([L, C, h]: Triple): Triple => {
  let lo = 0;
  let hi = C;
  if (isInGamut(oklabToLinear(oklchToOklab([L, C, h])))) {
    lo = C;
  } else {
    for (let i = 0; i < 64; i += 1) {
      const mid = (lo + hi) / 2;
      if (isInGamut(oklabToLinear(oklchToOklab([L, mid, h])))) lo = mid;
      else hi = mid;
    }
  }
  const linear = oklabToLinear(oklchToOklab([L, lo, h]));
  return linear.map((c) => Math.min(1, Math.max(0, linearToSrgb(c)))) as unknown as Triple;
};

/** The workspace swatches, read off `SettingsModal.getWorkspaceColorClass`. */
export const WORKSPACE_COLOR_HEX = {
  green: '#4a7c59',
  blue: '#3b82f6',
  pink: '#ec4899',
  yellow: '#eab308',
  orange: '#f97316',
  purple: '#8b5cf6',
  lilac: '#c084fc',
  coral: '#f43f5e',
  teal: '#14b8a6',
} as const;

export type WorkspaceColorName = keyof typeof WORKSPACE_COLOR_HEX;

/** The colour the transform was measured from. */
export const TRANSFORM_SOURCE_HEX = WORKSPACE_COLOR_HEX.blue;

export const ORB_PALETTE_SLOTS = [
  'shadowColor',
  'midLowColor',
  'midHighColor',
  'highlightColor',
] as const;

export interface OrbPaletteSlotTransform {
  /** Fraction of the remaining distance to white: L' = L + t * (1 - L). */
  readonly lightnessToWhite: number;
  /** Multiplier on OKLCh chroma. */
  readonly chromaScale: number;
  /** OKLCh hue rotation, degrees. */
  readonly hueShiftDeg: number;
}

/**
 * The measured transform, one entry per palette slot, in `ORB_PALETTE_SLOTS` order.
 *
 * Measured from `#3b82f6` (L 0.6230830295087604, C 0.18801471201981484, h
 * 259.8145266738871) against `materialDefaultPalette`.
 *
 * The midHigh row is the invariant, not a measurement: an OKLab round-trip of pure
 * white returns L 0.9999999826846379 and C 1.98e-7 because the forward matrix
 * coefficients sum to 0.9999999935 rather than 1. The seven-palette check gives
 * t = 1 and chroma 0 exactly, so those are the honest values -- and they make the
 * slot land on `#ffffff` for every swatch instead of near it.
 */
export const ORB_PALETTE_TRANSFORM: readonly OrbPaletteSlotTransform[] = [
  { lightnessToWhite: 0.10083344939449167, chromaScale: 0.9727158100734741, hueShiftDeg: 18.872864070072865 },
  { lightnessToWhite: 0.33964221059180466, chromaScale: 0.6783389009474345, hueShiftDeg: 2.2142361345095196 },
  { lightnessToWhite: 1, chromaScale: 0, hueShiftDeg: 0 },
  { lightnessToWhite: 0.6799570997965321, chromaScale: 0.3150745317975823, hueShiftDeg: 16.908401918755885 },
];

/**
 * Apply the measured transform to one workspace swatch.
 *
 * Returns the four slot colours as sRGB 0..1 triples, in `ORB_PALETTE_SLOTS` order —
 * the same order and units as a `HorizonPalette` in `interior.frag.glsl`.
 */
export const deriveOrbPalette = (hex: string): Triple[] => {
  const [L, C, h] = rgbToOklch(hexToRgb(hex));
  return ORB_PALETTE_TRANSFORM.map(({ lightnessToWhite, chromaScale, hueShiftDeg }) =>
    oklchToRgb([
      L + lightnessToWhite * (1 - L),
      C * chromaScale,
      (h + hueShiftDeg + 360) % 360,
    ]),
  );
};

/**
 * Shader palette index per workspace colour.
 *
 * Blue stays on index 0, the palette it already renders. Deriving it instead would
 * land 0..2 float32 ulps away — visually identical, but there is no reason to
 * recompute a value the shader already holds exactly when the requirement is that
 * blue keeps looking exactly as it does today.
 *
 * The other colors are the derived palettes appended to the shader at 7..14. The
 * shipped hand-authored palettes at 1..6 are left in place and still reachable
 * through `PALETTE_INDEX_BY_NAME`.
 */
export const WORKSPACE_PALETTE_INDEX = {
  blue: 0,
  green: 7,
  pink: 8,
  yellow: 9,
  orange: 10,
  purple: 11,
  lilac: 12,
  coral: 13,
  teal: 14,
} as const satisfies Record<WorkspaceColorName, number>;

