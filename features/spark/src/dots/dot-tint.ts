import { useMemo, type CSSProperties } from 'react';
import { useThemeMode } from '@willow/core/theme-mode';
import { tintSyncVariables, tintWorkspaceTheme } from '@willow/core/workspace-sync';
import type { WorkspaceComputedTheme } from '@willow/core/workspace-theme';
import { sparkAccentVarsFor } from '../spark-accent';
import { decodeCharacterState } from './character/orbit/appearance-codec';
import { getPresetAppearance } from './character/orbit/preset-appearances';
import { orbitCatalogTintColors } from './state/creation-store';
import type { SparkDot } from './dots-store';

/**
 * Each bundled pet's colour: its idle frame (the spritesheet's first cell), colourful pixels only,
 * the dominant hue averaged. Null Signal and Stacky are near-monochrome and are left out, so they
 * keep the blue, as a grey ring does.
 */
const PET_TINTS: Readonly<Record<string, string>> = {
  bsod: '#0482ef',
  codex: '#4c6ed0',
  dewey: '#37aae1',
  fireball: '#d74816',
  hoots: '#dd6503',
  rocky: '#a3886a',
  seedy: '#b3bb6e',
};

/** The body colours an orbit character can have: the catalog tints, and `light_yellow`, which only a preset uses. */
const ORBIT_COLORS: Readonly<Record<string, string>> = { ...orbitCatalogTintColors, light_yellow: '#FFE38A' };

/**
 * The colour a bot wears: its pet's when it has one, else its character's body colour (a plain
 * ring's tint, or a preset's, or the customised one). Null for a grey ring and anything unknown.
 */
export function dotTintHex(dot: Pick<SparkDot, 'presetId' | 'appearance' | 'petId'>): string | null {
  if (dot.petId != null) return PET_TINTS[dot.petId] ?? null;
  const bytes = dot.appearance != null
    ? Uint8Array.from(atob(dot.appearance), (character) => character.charCodeAt(0))
    : getPresetAppearance(dot.presetId);
  if (bytes == null) return null;
  try {
    return ORBIT_COLORS[decodeCharacterState(bytes).color] ?? null;
  } catch {
    return null;
  }
}

/**
 * The `--sync-*` values that colour a bot's own surfaces after the bot rather than the workspace:
 * blue (or grey) bots get Gemini's blues, others their counterparts.
 */
export function useDotTint(dot: Pick<SparkDot, 'presetId' | 'appearance' | 'petId'>): CSSProperties {
  const { presetId, appearance, petId } = dot;
  return useMemo(() => tintSyncVariables(dotTintHex({ presetId, appearance, petId })) as CSSProperties, [presetId, appearance, petId]);
}

const NO_DOT: Pick<SparkDot, 'presetId' | 'appearance' | 'petId'> = { presetId: '', appearance: null, petId: null };

/** The theme a dot wears where a whole theme is read rather than `--sync-*`: its composer's send button. */
export function useDotTheme(dot: Pick<SparkDot, 'presetId' | 'appearance' | 'petId'> | undefined): WorkspaceComputedTheme {
  const { presetId, appearance, petId } = dot ?? NO_DOT;
  return useMemo(() => tintWorkspaceTheme(dotTintHex({ presetId, appearance, petId })), [presetId, appearance, petId]);
}

/** Spark's accent variables (`--spark-accent`, `--spark-tonal-*`, …) in the dot's colour, for Spark's own buttons on its pages. */
export function useDotAccentVars(dot: Pick<SparkDot, 'presetId' | 'appearance' | 'petId'> | undefined): CSSProperties {
  const theme = useDotTheme(dot);
  const { isLight } = useThemeMode();
  return useMemo(() => sparkAccentVarsFor(theme, false, isLight), [theme, isLight]);
}
