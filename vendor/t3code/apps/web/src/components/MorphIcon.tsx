import { MorphIcon as BaseMorphIcon, type MorphIconProps } from "morphicons/react";

import { willowMorphGlyph } from "~/willow/morphGlyphs";

/**
 * Renders `lucide` icon data and morphs between shapes when `icon` changes; an icon Willow draws
 * as one of its own glyphs (willow/morphGlyphs.ts) is that glyph instead.
 */
export function MorphIcon({ reducedMotion = "user", ...props }: MorphIconProps) {
  const { icon, from: _from, to: _to, ...svgProps } = props;
  const Glyph = willowMorphGlyph(icon);
  if (Glyph) return <Glyph aria-hidden {...svgProps} />;
  return <BaseMorphIcon reducedMotion={reducedMotion} {...props} />;
}
