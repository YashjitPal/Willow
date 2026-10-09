// Flow TV's colours, as its bundle's design tokens have them: channels are themed with one of
// these palettes (`--theme-100` ... `--theme-700` on the remote), and every button names its colours
// by token (`"white"`, `"off-black"`, `"neutral-100"`, `"teal-700"`). Values are "r,g,b" triplets,
// which Flow TV's stylesheet wraps in rgba() with an alpha of its own.

export const TV_PALETTES = {
  pink: { 100: '255,240,254', 200: '255,221,252', 300: '255,190,250', 400: '208,142,203', 500: '189,113,183', 600: '121,37,75', 700: '41,25,32' },
  yellow: { 100: '250,255,225', 200: '236,249,166', 300: '218,239,104', 400: '193,217,61', 500: '160,184,28', 600: '85,98,13', 700: '24,29,0' },
  blurple: { 100: '204,209,255', 200: '170,178,255', 300: '142,154,255', 400: '111,124,241', 500: '93,106,223', 600: '64,71,124', 700: '24,27,60' },
  purple: { 100: '244,243,255', 200: '231,228,255', 300: '192,186,242', 400: '167,158,239', 500: '130,119,215', 600: '80,73,137', 700: '43,38,74' },
  green: { 100: '218,255,235', 200: '174,241,204', 300: '115,210,158', 400: '97,195,142', 500: '72,159,112', 600: '50,112,78', 700: '26,53,38' },
  red: { 100: '255,228,228', 200: '255,193,193', 300: '236,153,153', 400: '201,112,112', 500: '165,89,89', 600: '114,59,59', 700: '52,26,26' },
  orange: { 100: '255,203,187', 200: '255,176,151', 300: '255,140,103', 400: '228,113,76', 500: '201,93,59', 600: '155,75,49', 700: '38,18,11' },
  blue: { 100: '219,241,255', 200: '197,231,255', 300: '175,222,255', 400: '96,160,202', 500: '75,133,170', 600: '55,94,119', 700: '20,34,45' },
  gold: { 100: '255,242,189', 200: '255,231,131', 300: '255,206,0', 400: '217,175,0', 500: '172,139,0', 600: '117,94,0', 700: '67,54,0' },
  teal: { 100: '228,255,252', 200: '193,255,248', 300: '145,250,237', 400: '112,201,190', 500: '89,165,156', 600: '59,114,107', 700: '26,52,49' },
  brown: { 100: '224,218,212', 200: '203,191,180', 300: '186,166,148', 400: '142,123,106', 500: '130,115,100', 600: '92,81,70', 700: '47,40,34' },
  gray: { 100: '255,255,255', 200: '199,199,199', 300: '199,199,199', 400: '199,199,199', 500: '185,185,185', 600: '143,143,143', 700: '69,69,69' },
} as const;

const NEUTRAL = { 0: '255,255,255', 50: '248,249,250', 100: '241,243,244', 200: '232,234,237', 300: '218,220,224', 400: '189,193,198', 500: '154,160,166', 600: '128,134,139', 700: '95,99,104', 800: '60,64,67', 900: '32,33,36', 1000: '0,0,0' } as const;

export type TvPaletteName = keyof typeof TV_PALETTES;
export type TvShade = 100 | 200 | 300 | 400 | 500 | 600 | 700;
export const TV_PALETTE_NAMES = Object.keys(TV_PALETTES) as TvPaletteName[];

/** A colour token's "r,g,b": `white`, `black`, `off-black`, `neutral-100`, `<palette>-<shade>`. */
export function tvColor(token: string): string {
  if (token === 'white') return '255,255,255';
  if (token === 'black') return '0,0,0';
  if (token === 'off-black') return '27,27,27';
  const m = /^([a-z]+)-(\d+)$/.exec(token);
  if (!m) throw new Error(`Unknown Flow TV colour '${token}'`);
  const shade = Number(m[2]);
  if (m[1] === 'neutral') return NEUTRAL[shade as keyof typeof NEUTRAL];
  return TV_PALETTES[m[1] as TvPaletteName][shade as TvShade];
}

/** Flow TV's `themeStyle(theme, shades)`: `--theme-<shade>` for each shade asked for. */
export function themeVars(theme: TvPaletteName, shades: readonly TvShade[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const shade of shades) out[`--theme-${shade}`] = TV_PALETTES[theme][shade];
  return out;
}

/**
 * The palette a channel wears. Flow TV's are picked per channel by its curators; Willow's
 * channels are projects, so each gets one from its id, the same every visit.
 */
export function channelTheme(projectId: string): TvPaletteName {
  let h = 2166136261;
  for (let i = 0; i < projectId.length; i += 1) h = Math.imul(h ^ projectId.charCodeAt(i), 16777619);
  return TV_PALETTE_NAMES[(h >>> 0) % TV_PALETTE_NAMES.length];
}
