/**
 * Inline SVGs the composer draws itself.
 *
 * These are brand/decorative marks with no lucide equivalent, so they are
 * hand-rolled rather than imported. Moved out of Composer.tsx verbatim.
 */

import React from 'react';
import {
  CircleUserRound,
  Component,
  Lightbulb,
  MessageCirclePlus,
} from 'lucide-react';

export const StitchComponentsIcon = Component;

/**
 * Codex's four menu icons are Lucide components, not font glyphs. Re-exporting
 * the package components keeps their exact icon nodes and renderer contract.
 * Codex's Lucide renderer uses a 2px stroke; the menu-sized instances are
 * rendered at 18px inside the 24px icon column.
 */
/**
 * Stitch's Ideate Sparkle Lightbulb icon copied directly from extracted code (`useHorizontalDragToScroll-Buq8ZpsS.js` - `Wn`).
 */
export const StitchIdeateIcon = React.forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement> & {
  size?: number | string;
}>(({ size = 20, className, ...props }, ref) => (
  <svg
    ref={ref}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 18 18"
    width={size}
    height={size}
    fill="none"
    className={className}
    {...props}
  >
    <path
      d="M6.75 14.85V13.5H11.25V14.85H6.75ZM9 17.1C8.625 17.1 8.30625 16.9687 8.04375 16.7062C7.78125 16.4437 7.65 16.125 7.65 15.75H10.35C10.35 16.125 10.2188 16.4437 9.95625 16.7062C9.69375 16.9687 9.375 17.1 9 17.1ZM6.95625 12.6C6.09375 12.2 5.39375 11.6062 4.85625 10.8187C4.31875 10.0187 4.05 9.1125 4.05 8.1C4.05 6.725 4.53125 5.55625 5.49375 4.59375C6.45625 3.63125 7.625 3.15 9 3.15C9 3.15 9.075 3.15 9.225 3.15C9.375 3.15 9.45 3.15625 9.45 3.16875C9.45 3.38125 9.45 3.6125 9.45 3.8625C9.45 4.1 9.45 4.325 9.45 4.5375C9.45 4.525 9.375 4.51875 9.225 4.51875C9.075 4.50625 9 4.5 9 4.5C8 4.5 7.15 4.85 6.45 5.55C5.75 6.25 5.4 7.1 5.4 8.1C5.4 8.7625 5.5625 9.375 5.8875 9.9375C6.225 10.4875 6.68125 10.925 7.25625 11.25H10.7438C11.2563 10.9625 11.6813 10.5625 12.0188 10.05C12.3688 9.5375 12.5563 9.0375 12.5813 8.55C12.7938 8.55 13.0188 8.55 13.2563 8.55C13.4938 8.55 13.7188 8.55 13.9313 8.55C13.8563 9.375 13.575 10.1562 13.0875 10.8937C12.6125 11.6312 11.9375 12.2 11.0625 12.6H6.95625ZM13.95 7.2C13.875 7.2 13.825 7.1625 13.8 7.0875C13.625 6.375 13.275 5.7625 12.75 5.25C12.2375 4.725 11.625 4.375 10.9125 4.2C10.8375 4.175 10.8 4.125 10.8 4.05C10.8 3.9625 10.8375 3.9125 10.9125 3.9C11.625 3.725 12.2375 3.38125 12.75 2.86875C13.275 2.34375 13.625 1.725 13.8 1.0125C13.825 0.937499 13.875 0.899999 13.95 0.899999C14.0375 0.899999 14.0875 0.937499 14.1 1.0125C14.2875 1.725 14.6375 2.3375 15.15 2.85C15.6625 3.3625 16.275 3.7125 16.9875 3.9C17.0625 3.9125 17.1 3.9625 17.1 4.05C17.1 4.125 17.0625 4.175 16.9875 4.2C16.275 4.375 15.6563 4.725 15.1313 5.25C14.6188 5.7625 14.275 6.375 14.1 7.0875C14.0875 7.1625 14.0375 7.2 13.95 7.2Z"
      fill="currentColor"
    />
  </svg>
));
StitchIdeateIcon.displayName = 'StitchIdeateIcon';

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
