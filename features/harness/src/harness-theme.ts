/**
 * An agent tab's colours, from its mark: the mark's colour through Willow's colour engine
 * (platform/core workspace-theme.ts, and features/media home-glow.ts for the glow behind a new
 * thread's prompt box), as a workspace colour gives Willow's own pages theirs, the desktop frame
 * round the page included. A mark in one of Willow's swatches (Codex's blue) takes that swatch's
 * measured accents; a monochrome mark takes neutral greys, its glow Willow's temporary-chat grey.
 */
import {
  computeWorkspaceTheme,
  FRAME_SHELL_TRANSFORM,
  getWorkspaceTheme,
  oklchToRgb,
  rgbToHex,
  WORKSPACE_COLOR_DEFINITIONS,
  type WorkspaceComputedTheme,
} from '@willow/core/workspace-theme';
import {
  deriveGlowAccentLight,
  deriveGlowMobileAccent,
  homeGlowAccentLight,
  homeGlowDesktopAccent,
  homeGlowMobileAccent,
} from '@willow/media/home-glow';
import { harnessById, type HarnessId } from './harnesses';

/** What the agents' page draws with (its bridge.ts `WillowPalette`). */
export interface HarnessPalette {
  glow: string;
  glowLight: string;
  /** The glow behind a new thread's prompt box in dark theme (home-glow.ts's desktop accent). */
  glowDesktop: string;
  /** That glow at Willow's compact width, rising from the bottom (home-glow.ts's mobile accent). */
  glowMobile: string;
  send: string;
  sendHover: string;
  sendLight: string;
  sendLightHover: string;
  chip: string;
  toggleTrack: string;
  toggleThumb: string;
  accent: string;
  accentHover: string;
  loadbar: string;
}

/** Gemini's `--gem-sys-color--outline-variant`, the glow of Willow's temporary chat (apps/studio index.html). */
const NEUTRAL_GLOW = 'rgb(68, 71, 70)';
const NEUTRAL_GLOW_LIGHT = 'rgb(196, 199, 197)';
const NEUTRAL_HEX = '#9aa0a6';

const fromTheme = (theme: WorkspaceComputedTheme, glowDesktop: string, glowMobile: string, glowLight: string): HarnessPalette => ({
  glow: theme.glowAccent,
  glowLight,
  glowDesktop,
  glowMobile,
  send: theme.sendButton.bg,
  sendHover: theme.sendButton.hover,
  sendLight: theme.sendButton.lightBg,
  sendLightHover: theme.sendButton.lightHover,
  chip: theme.chipBg,
  toggleTrack: theme.toggle.track,
  toggleThumb: theme.toggle.thumb,
  accent: theme.accentButton.bg,
  accentHover: theme.accentButton.hover,
  loadbar: theme.loadbar.hex,
});

/** The desktop frame's shell round Willow's page (workspace-theme.ts `frameShell`). */
export type HarnessFrameShell = WorkspaceComputedTheme['frameShell'];

interface HarnessColours {
  palette: HarnessPalette;
  frameShell: HarnessFrameShell;
}

const derive = (id: HarnessId): HarnessColours => {
  const harness = harnessById(id);
  if (harness.mark === null) {
    const theme = computeWorkspaceTheme({ id: 'harness-neutral', label: 'Neutral', hex: NEUTRAL_HEX });
    return {
      // A grey has no hue for the engine to carry to the toggle's thumb; it takes the darker grey.
      palette: { ...fromTheme(theme, NEUTRAL_GLOW, NEUTRAL_GLOW, NEUTRAL_GLOW_LIGHT), toggleThumb: theme.accentButton.hover },
      // Nor to tint the frame with: the shell's lightness, untinted.
      frameShell: {
        dark: rgbToHex(oklchToRgb([FRAME_SHELL_TRANSFORM.darkLightness, 0, 0])),
        light: rgbToHex(oklchToRgb([FRAME_SHELL_TRANSFORM.lightLightness, 0, 0])),
      },
    };
  }
  const mark = harness.mark.toLowerCase();
  const swatch = WORKSPACE_COLOR_DEFINITIONS.find((definition) => definition.hex.toLowerCase() === mark);
  if (swatch) {
    const theme = getWorkspaceTheme(swatch.id);
    return {
      palette: fromTheme(theme, homeGlowDesktopAccent(swatch.id), homeGlowMobileAccent(swatch.id), homeGlowAccentLight(swatch.id)),
      frameShell: theme.frameShell,
    };
  }
  const theme = computeWorkspaceTheme({ id: `harness-${id}`, label: harness.label, hex: mark });
  const glowMobile = deriveGlowMobileAccent(mark);
  return { palette: fromTheme(theme, glowMobile, glowMobile, deriveGlowAccentLight(mark)), frameShell: theme.frameShell };
};

const colours = new Map<HarnessId, HarnessColours>();

const coloursOf = (id: HarnessId): HarnessColours => {
  let found = colours.get(id);
  if (!found) {
    found = derive(id);
    colours.set(id, found);
  }
  return found;
};

export function harnessPalette(id: HarnessId): HarnessPalette {
  return coloursOf(id).palette;
}

/** The frame round Willow's page while an agent's tab is on show, tinted by its mark as a workspace colour tints it. */
export function harnessFrameShell(id: HarnessId): HarnessFrameShell {
  return coloursOf(id).frameShell;
}
