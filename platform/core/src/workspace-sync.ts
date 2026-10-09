/**
 * Workspace colour sync for the surfaces transcribed from Gemini.
 *
 * Gemini's interface is blue, and what Willow cloned from it — Deep Research, the media cards and
 * galleries, Gems, the settings pages, Spark and the rest — came across in its literal blues. Blue
 * is the anchor: each of those blues says how its role looks on a blue workspace, and this module
 * answers how the same role looks on every other workspace colour.
 *
 * A stylesheet writes `var(--sync-a8c7fa, #a8c7fa)`, or for a translucent use
 * `rgba(var(--sync-a8c7fa-rgb, 168, 199, 250), 0.08)`. On a blue workspace nothing is published,
 * so each surface keeps Gemini's measured value byte for byte; on any other colour the app
 * publishes every anchor's counterpart on the root element, where portalled menus see it too.
 *
 * How a counterpart is found, in order:
 *
 * 1. A blue that already plays a role in `workspace-theme.ts` takes that role's value, so a synced
 *    surface agrees with what was themed before it: the pastel primary is `creamy`, filled buttons
 *    are the accent button, the tonal callout is `notice`, and so on (`ROLE_ANCHORS`).
 * 2. A blue close to one of those (a hover tint, a pressed shade) keeps its offset from it: the
 *    same lightness step, chroma ratio and hue turn, applied to that role's value.
 * 3. Any other blue keeps its OKLCh lightness, and with it its contrast against Gemini's greys;
 *    takes the workspace colour's hue, turned as far as the blue sits from the blue swatch; and
 *    scales its chroma by how saturated the workspace colour is beside that swatch.
 *
 * A Gemini blue that a surface starts using goes in `SYNC_ANCHORS`.
 */

import {
  WORKSPACE_COLOR_DEFINITIONS,
  computeWorkspaceTheme,
  getWorkspaceTheme,
  hexToRgb,
  oklchToRgb,
  rgbToHex,
  rgbToOklch,
  type WorkspaceComputedTheme,
} from './workspace-theme';

type Triple = readonly [number, number, number];

/** Every Gemini blue a synced surface reads through `--sync-<hex>`. */
export const SYNC_ANCHORS: readonly string[] = [
  '#001d35', '#003060', '#003d64', '#004a77', '#041e49', '#04409f', '#062e6f', '#073888',
  '#0842a0', '#0b5585', '#0b57d0', '#14204f', '#192967', '#1a73e8', '#1c2a6b', '#1d2f73',
  '#1e2b48', '#1f3760', '#1f3b9b', '#2596be', '#26449f', '#2846b4', '#2948a8', '#2f5be3',
  '#3186ff', '#36568d', '#4099ff', '#4e8ff8', '#58a1ff', '#60a9ed', '#669df6', '#8ab4f8',
  '#90b7f8', '#a8c7fa', '#b4d0fc', '#b8d2fa', '#b8d2ff', '#b9c8ff', '#bcd4fb', '#c2d7fc',
  '#c2e7ff', '#c3ddff', '#d1e1ff', '#d3e3fd',
];

const parseColor = (value: string): Triple => {
  if (value.startsWith('#')) return hexToRgb(value);
  const [r, g, b] = value.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
  return [r / 255, g / 255, b / 255];
};

/** Blues the theme engine already gives a role, with that role's value on any workspace colour. */
const ROLE_ANCHORS: Record<string, (theme: WorkspaceComputedTheme) => string> = {
  '#a8c7fa': (theme) => theme.creamy.hex,
  '#062e6f': (theme) => theme.toggle.thumb,
  '#1f3760': (theme) => theme.notice.bg,
  '#d3e3fd': (theme) => theme.notice.text,
  '#1f3b9b': (theme) => theme.accentButton.bg,
  '#14204f': (theme) => theme.glowAccent,
  '#3186ff': (theme) => theme.fileDrop.text,
};

/** Gemini's filled-button hovers, each measured on its own surface; one role covers them. */
const ACCENT_HOVERS = new Set(['#26449f', '#2846b4', '#2948a8']);

/**
 * The roles a nearby blue may be a variant of. The notice text and the glow are left out: their
 * values move far from Gemini's lightness on some colours (green's glow is lifted, its notice text
 * greyed), and a hover tint or a dark label carried along would lose its contrast or its colour.
 */
const VARIANT_BASES = ['#a8c7fa', '#062e6f', '#1f3760', '#1f3b9b', '#3186ff'];

/**
 * How far (OKLab distance) a blue may sit from a base and still be its variant. Wide enough that
 * Gemini's light primary `#0b57d0` (0.10 from the filled button) moves with its `#0842a0` hover.
 */
const VARIANT_REACH = 0.11;

const BLUE_SWATCH = rgbToOklch(hexToRgb(WORKSPACE_COLOR_DEFINITIONS.find((def) => def.id === 'blue')!.hex));

const oklabDistance = ([L1, C1, h1]: Triple, [L2, C2, h2]: Triple): number => {
  const a1 = C1 * Math.cos((h1 * Math.PI) / 180);
  const b1 = C1 * Math.sin((h1 * Math.PI) / 180);
  const a2 = C2 * Math.cos((h2 * Math.PI) / 180);
  const b2 = C2 * Math.sin((h2 * Math.PI) / 180);
  return Math.hypot(L1 - L2, a1 - a2, b1 - b2);
};

const turn = (hue: number): number => ((hue % 360) + 360) % 360;

const counterpart = (anchorHex: string, theme: WorkspaceComputedTheme): string => {
  const role = ROLE_ANCHORS[anchorHex];
  if (role) return rgbToHex(parseColor(role(theme)));
  if (ACCENT_HOVERS.has(anchorHex)) return rgbToHex(parseColor(theme.accentButton.hover));

  const anchor = rgbToOklch(hexToRgb(anchorHex));
  let nearest: { blue: Triple; value: Triple; distance: number } | null = null;
  for (const baseHex of VARIANT_BASES) {
    const blue = rgbToOklch(hexToRgb(baseHex));
    const distance = oklabDistance(anchor, blue);
    if (distance <= VARIANT_REACH && (!nearest || distance < nearest.distance)) {
      nearest = { blue, value: rgbToOklch(parseColor(ROLE_ANCHORS[baseHex](theme))), distance };
    }
  }
  if (nearest) {
    const [L, C, h] = anchor;
    const [Lb, Cb, hb] = nearest.blue;
    const [Lv, Cv, hv] = nearest.value;
    return rgbToHex(oklchToRgb([
      Math.min(0.99, Math.max(0, Lv + (L - Lb))),
      Cv * (Cb > 1e-4 ? C / Cb : 1),
      turn(hv + (h - hb)),
    ]));
  }

  const [L, C, h] = anchor;
  const [, Cs, hs] = rgbToOklch(hexToRgb(theme.swatchHex));
  const [, Cblue, hblue] = BLUE_SWATCH;
  return rgbToHex(oklchToRgb([L, C * Math.min(1.2, Math.max(0.5, Cs / Cblue)), turn(hs + (h - hblue))]));
};

const cache = new Map<string, Record<string, string>>();

/** The workspace colour's counterpart of one Gemini blue (the blue itself on a blue workspace). */
export const syncedColor = (anchorHex: string, colorId?: string | null): string => {
  const theme = getWorkspaceTheme(colorId);
  const anchor = anchorHex.toLowerCase();
  return theme.id === 'blue' ? anchor : counterpart(anchor, theme);
};

/**
 * The custom properties a workspace colour publishes: `--sync-<hex>` and `--sync-<hex>-rgb` for
 * every anchor. Empty for blue, where every surface falls back to the anchor itself.
 */
export const workspaceSyncVariables = (colorId?: string | null): Record<string, string> => {
  const theme = getWorkspaceTheme(colorId);
  if (theme.id === 'blue') return {};
  const cached = cache.get(theme.id);
  if (cached) return cached;
  const variables = variablesFor(theme);
  cache.set(theme.id, variables);
  return variables;
};

/** `--sync-<hex>` and `--sync-<hex>-rgb` for every anchor: its counterpart, or the anchor itself without a theme. */
const variablesFor = (theme: WorkspaceComputedTheme | null): Record<string, string> => {
  const variables: Record<string, string> = {};
  for (const anchor of SYNC_ANCHORS) {
    const value = theme ? counterpart(anchor, theme) : anchor;
    const [r, g, b] = hexToRgb(value).map((channel) => Math.round(channel * 255));
    variables[`--sync-${anchor.slice(1)}`] = value;
    variables[`--sync-${anchor.slice(1)}-rgb`] = `${r}, ${g}, ${b}`;
  }
  return variables;
};

/** How near the blue swatch's hue a tint may sit and still be blue: the orbit catalog's blue, a blue pet. */
const BLUE_HUE_REACH = 12;
/** Below this chroma a tint is grey, and a grey keeps the blue. */
const GREY_CHROMA = 0.04;

const tintCache = new Map<string, Record<string, string>>();

/**
 * `--sync-*` values that tint a subtree with a colour of its own rather than the workspace's: a
 * dot's colour across its profile, say. Blue stays the anchor — a tint near the blue swatch's hue,
 * a grey, or no tint gives Gemini's blues themselves — and any other colour gets the counterparts
 * a workspace of that colour would. Every property is set either way, so the workspace's values
 * never show through.
 */
export const tintSyncVariables = (hex?: string | null): Record<string, string> => {
  const key = tintKey(hex);
  const cached = tintCache.get(key);
  if (cached) return cached;
  const variables = variablesFor(key === 'blue' ? null : tintTheme(key));
  tintCache.set(key, variables);
  return variables;
};

/** `blue` for a tint that keeps Gemini's blues — none, a grey, or one near the blue swatch — else the tint itself. */
const tintKey = (hex?: string | null): string => {
  if (!hex) return 'blue';
  const [, C, h] = rgbToOklch(hexToRgb(hex));
  const hueGap = Math.abs(((h - BLUE_SWATCH[2] + 540) % 360) - 180);
  return C >= GREY_CHROMA && hueGap > BLUE_HUE_REACH ? hex.toLowerCase() : 'blue';
};

const tintThemes = new Map<string, WorkspaceComputedTheme>();
const tintTheme = (key: string): WorkspaceComputedTheme => {
  let theme = tintThemes.get(key);
  if (!theme) {
    theme = computeWorkspaceTheme({ id: `tint:${key}`, label: key, hex: key });
    tintThemes.set(key, theme);
  }
  return theme;
};

/**
 * A tint's counterpart of any blue, anchor or not — what `tintSyncVariables` would publish for it —
 * for colours drawn outside a stylesheet: a picture recoloured to a dot's colour, say.
 */
export const tintedColor = (blueHex: string, tintHex?: string | null): string => {
  const key = tintKey(tintHex);
  return key === 'blue' ? blueHex.toLowerCase() : counterpart(blueHex.toLowerCase(), tintTheme(key));
};

/**
 * The whole theme a tint wears, for what reads a theme rather than `--sync-*` — a composer's send button, Spark's
 * accent variables: the blue workspace's for a tint that keeps Gemini's blues, else the tint's own, the same one
 * `tintSyncVariables` publishes from.
 */
export const tintWorkspaceTheme = (hex?: string | null): WorkspaceComputedTheme => {
  const key = tintKey(hex);
  return key === 'blue' ? getWorkspaceTheme('blue') : tintTheme(key);
};

/** Every property `workspaceSyncVariables` can set, so a switch back to blue can clear them. */
export const SYNC_VARIABLE_NAMES: readonly string[] = SYNC_ANCHORS.flatMap((anchor) => [
  `--sync-${anchor.slice(1)}`,
  `--sync-${anchor.slice(1)}-rgb`,
]);

/** Publishes the workspace colour's counterparts on `root` (the document element by default). */
export const applyWorkspaceSync = (colorId?: string | null, root: HTMLElement = document.documentElement): void => {
  const variables = workspaceSyncVariables(colorId);
  for (const name of SYNC_VARIABLE_NAMES) {
    const value = variables[name];
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
};
