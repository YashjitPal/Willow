/**
 * Inline SVGs the composer draws itself.
 *
 * These are brand/decorative marks with no lucide equivalent, so they are
 * hand-rolled rather than imported. Moved out of Composer.tsx verbatim.
 */

import React from 'react';
import {
  CircleUserRound,
  Lightbulb,
  MessageCirclePlus,
} from 'lucide-react';

/**
 * Codex's four menu icons are Lucide components, not font glyphs. Re-exporting
 * the package components keeps their exact icon nodes and renderer contract.
 * Codex's Lucide renderer uses a 2px stroke; the menu-sized instances are
 * rendered at 18px inside the 24px icon column.
 */
export const CodexPlanIcon = Lightbulb;
export const CodexPetIcon = CircleUserRound;
/** Codex's side-chat action uses the speech-bubble-plus glyph, not CirclePlus. */
export const CodexSideChatIcon = MessageCirclePlus;

/**
 * Codex's Goal icon, copied from its extracted `goal-*.js` Lucide module.
 * Keeping the path data here avoids substituting Willow's potentially different
 * lucide-react package version for the glyph Codex actually ships.
 */
export const CodexGoalIcon = React.forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement> & {
  size?: number | string;
  strokeWidth?: number | string;
}>(({ size = 24, strokeWidth = 2, ...props }, ref) => (
  <svg
    ref={ref}
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M12 13V2l8 4-8 4" />
    <path d="M20.561 10.222a9 9 0 1 1-12.55-5.29" />
    <path d="M8.002 9.997a5 5 0 1 0 8.9 2.02" />
  </svg>
));
CodexGoalIcon.displayName = 'CodexGoalIcon';

/** Four-point star used as the generic "model" mark in the model picker. */
export const ModelIcon = ({ size = 18, ...props }: any) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 512 512"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path d="M256 0C256 0 292 200 512 256C292 312 256 512 256 512C256 512 220 312 0 256C220 200 256 0 256 0Z" />
  </svg>
);
