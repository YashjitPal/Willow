import React from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

import {
  NEW_GEM_LOGO_DARK,
  NEW_GEM_LOGO_LIGHT,
  gemInitial,
  gemLogoColors,
  gemPaletteIndex,
  type GemLogoColors,
} from './gem-types';
import type { ResolvedGem } from './gems-store';

export type GemLogoMark =
  | { kind: 'letter'; letter: string }
  | { kind: 'symbol'; name: string }
  | { kind: 'svg'; path: string };

export interface GemLogoSpec {
  mark: GemLogoMark;
  colors: GemLogoColors;
}

/** A saved or premade Gem's logo: its glyph or initial, in its palette slot. */
export const gemLogoSpec = (resolved: ResolvedGem, isLight: boolean): GemLogoSpec => {
  if (resolved.kind === 'premade') {
    return {
      mark: resolved.gem.logo.kind === 'svg'
        ? { kind: 'svg', path: resolved.gem.logo.path }
        : { kind: 'symbol', name: resolved.gem.logo.name },
      colors: gemLogoColors(resolved.gem.palette, isLight),
    };
  }
  return {
    mark: { kind: 'letter', letter: gemInitial(resolved.gem.name) },
    colors: gemLogoColors(gemPaletteIndex(resolved.gem.id), isLight),
  };
};

/**
 * An unsaved Gem's logo: Gemini's neutral `gem_spark` disc until the Gem has a name, then
 * that name's initial on the same neutral disc.
 */
export const draftLogoSpec = (name: string, isLight: boolean): GemLogoSpec => {
  const letter = gemInitial(name);
  return {
    mark: letter ? { kind: 'letter', letter } : { kind: 'symbol', name: 'gem_spark' },
    colors: isLight ? NEW_GEM_LOGO_LIGHT : NEW_GEM_LOGO_DARK,
  };
};

/**
 * `bot-logo`: a disc with the glyph or letter at 56.25% of its size — 15.75 in the 28px
 * card and row logos, 28.125 in the editor's 50px one, 34.875 in a chat's 62px one.
 */
export const GemLogo: React.FC<{ spec: GemLogoSpec; size: number; className?: string }> = ({ spec, size, className = '' }) => {
  const glyph = size * 0.5625;
  return (
    <div
      aria-hidden="true"
      className={`gem-logo ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: spec.colors.bg,
        color: spec.colors.fg,
        fontSize: glyph,
        lineHeight: `${size}px`,
      }}
    >
      {spec.mark.kind === 'letter' && spec.mark.letter}
      {spec.mark.kind === 'symbol' && (
        <MaterialSymbol name={spec.mark.name} family="google-symbols" size={glyph} weight={400} />
      )}
      {spec.mark.kind === 'svg' && (
        <svg viewBox="0 -960 960 960" width={glyph} height={glyph} focusable="false">
          <path d={spec.mark.path} />
        </svg>
      )}
    </div>
  );
};
