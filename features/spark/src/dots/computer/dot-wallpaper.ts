import { tintedColor } from '@willow/core/workspace-sync';

/*
 * How a bot's computer looks in the bot's colour: its wallpaper and its browser.
 *
 * The wallpaper is "Blue Hour", the picture Codex shows for a
 * bot's computer until it has one of its own (`dot/computer/blue-hour.ts`) —
 * midnight indigo, a cobalt current and a lavender dawn — in the bot's colour.
 * Each stop takes the bot's counterpart of its blue, as the bot's tint does
 * for Gemini's blues (`tintedColor`), so a blue or grey bot gets the picture as
 * it is. The profile's placeholder is the same picture; the computer service
 * draws it on the desktop from these colours (`machine/service.mjs`,
 * `wallpaperSvg`, which must stay the same picture).
 */

/** Blue Hour's colours, in the order the picture uses them. */
export const BLUE_HOUR_STOPS = [
  '#181d51', '#124ba4', '#1681e9', '#8cacf5',
  '#087bfa', '#0869e8',
  '#25a7fa', '#3696fb',
  '#f1d8ff', '#d9c7ff', '#b9b9ff', '#91afff',
  '#24173e',
] as const;

export const dotWallpaperColors = (tint: string | null | undefined): string[] => BLUE_HOUR_STOPS.map((stop) => tintedColor(stop, tint));

export const dotWallpaperSvg = (c: readonly string[]): string => `<svg xmlns='http://www.w3.org/2000/svg' width='3840' height='2160' viewBox='0 0 3840 2160' preserveAspectRatio='xMidYMid slice'><defs>`
  + `<linearGradient id='atmosphere' x1='0.1' y1='0' x2='0.8' y2='1'><stop stop-color='${c[0]}'/><stop offset='0.36' stop-color='${c[1]}'/><stop offset='0.7' stop-color='${c[2]}'/><stop offset='1' stop-color='${c[3]}'/></linearGradient>`
  + `<radialGradient id='cobalt' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='1' gradientTransform='translate(2650 890) rotate(-18) scale(2670 1390)'><stop stop-color='${c[4]}' stop-opacity='0.86'/><stop offset='0.48' stop-color='${c[5]}' stop-opacity='0.56'/><stop offset='1' stop-color='${c[5]}' stop-opacity='0'/></radialGradient>`
  + `<radialGradient id='azure' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='1' gradientTransform='translate(500 1570) rotate(-22) scale(2400 1080)'><stop stop-color='${c[6]}' stop-opacity='0.72'/><stop offset='0.55' stop-color='${c[7]}' stop-opacity='0.36'/><stop offset='1' stop-color='${c[7]}' stop-opacity='0'/></radialGradient>`
  + `<radialGradient id='lavender' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='1' gradientTransform='translate(1520 2570) rotate(8) scale(2660 1630)'><stop stop-color='${c[8]}'/><stop offset='0.28' stop-color='${c[9]}' stop-opacity='0.98'/><stop offset='0.58' stop-color='${c[10]}' stop-opacity='0.72'/><stop offset='0.81' stop-color='${c[11]}' stop-opacity='0.24'/><stop offset='1' stop-color='${c[11]}' stop-opacity='0'/></radialGradient>`
  + `<radialGradient id='indigo' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='1' gradientTransform='translate(-240 -210) rotate(22) scale(2100 1680)'><stop stop-color='${c[12]}' stop-opacity='0.60'/><stop offset='1' stop-color='${c[12]}' stop-opacity='0'/></radialGradient>`
  + `</defs><path fill='url(#atmosphere)' d='M0 0h3840v2160H0z'/><path fill='url(#cobalt)' d='M0 0h3840v2160H0z'/><path fill='url(#azure)' d='M0 0h3840v2160H0z'/><path fill='url(#lavender)' d='M0 0h3840v2160H0z'/><path fill='url(#indigo)' d='M0 0h3840v2160H0z'/></svg>`;

export const dotWallpaperUrl = (colors: readonly string[]): string => `data:image/svg+xml,${encodeURIComponent(dotWallpaperSvg(colors))}`;

/**
 * The browser on OpenAI's bot's computer, measured from Codex's picture of it:
 * its frame, and its toolbar and active tab. The bot's browser wears them in
 * the bot's colour — lightness kept, so its dark text stays legible.
 */
export const BROWSER_COLORS = { frame: '#a2b6ce', toolbar: '#d7e0e9' } as const;

export const dotBrowserColors = (tint: string | null | undefined): { frame: string; toolbar: string } => ({
  frame: tintedColor(BROWSER_COLORS.frame, tint),
  toolbar: tintedColor(BROWSER_COLORS.toolbar, tint),
});
