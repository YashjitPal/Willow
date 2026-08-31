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
 * Codex's Goal icon, copied from its extracted `expandedTopTray` module (`WMc`).
 * Renders the target bullseye struck by a dart/arrow.
 */
export const CodexGoalIcon = React.forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement> & {
  size?: number | string;
  strokeWidth?: number | string;
}>(({ size = 20, strokeWidth = 2, ...props }, ref) => (
  <svg
    ref={ref}
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    {...props}
  >
    <path
      d="M9.96861 1.91681C10.3002 1.91681 10.569 2.18564 10.569 2.51722C10.5688 2.84865 10.3001 3.11764 9.96861 3.11764C6.14529 3.11779 3.04595 6.21713 3.04579 10.0404C3.04597 13.8637 6.14531 16.964 9.96861 16.9641C13.792 16.9641 16.8921 13.8638 16.8923 10.0404C16.8925 9.709 17.1612 9.44003 17.4927 9.44003C17.8241 9.44019 18.093 9.7091 18.0931 10.0404C18.0929 14.527 14.4552 18.165 9.96861 18.165C5.48215 18.1648 1.84515 14.5269 1.84497 10.0404C1.84513 5.55398 5.48214 1.91697 9.96861 1.91681Z"
      fill="currentColor"
    />
    <path
      d="M8.73428 5.4417C9.05275 5.34987 9.38553 5.53321 9.47752 5.85167C9.56932 6.17 9.38575 6.50275 9.06755 6.59491C7.60672 7.01688 6.53899 8.36477 6.53894 9.96021C6.53907 11.8943 8.10685 13.4629 10.0409 13.4631C11.6106 13.463 12.9407 12.429 13.385 11.0041C13.4838 10.6877 13.8206 10.5114 14.1371 10.61C14.4536 10.7087 14.6308 11.0455 14.5321 11.3621C13.9357 13.2742 12.1509 14.663 10.0409 14.663C7.44369 14.6628 5.33824 12.5574 5.33812 9.96021C5.33816 7.81571 6.77345 6.00809 8.73428 5.4417Z"
      fill="currentColor"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M13.8656 1.99087C14.3948 1.60393 15.1805 1.97721 15.1739 2.67063L15.1528 4.83776L17.319 4.8166L17.4539 4.82541C18.1023 4.92002 18.4014 5.73603 17.9115 6.22638L15.5046 8.63331C15.3075 8.83039 15.04 8.94171 14.7613 8.94189H12.2063L10.3936 10.7555C10.1591 10.9899 9.77811 10.9899 9.54364 10.7555C9.30989 10.521 9.30952 10.1407 9.54364 9.90643L11.0486 8.40144V5.22922C11.0486 4.95027 11.1591 4.68234 11.3563 4.48509L13.7633 2.07816L13.8656 1.99087ZM12.2495 5.29005V7.74107H14.6978L16.4136 6.02536L13.9414 6.05004L13.9643 3.57434L12.2495 5.29005Z"
      fill="currentColor"
    />
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
