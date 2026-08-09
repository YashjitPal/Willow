/**
 * The seven icons the voice-settings panel draws.
 *
 * Upstream serves these from two sprite sheets and references them by opaque id
 * (`<use href="/cdn/assets/sprites-core-c69945c5.svg#85f94b">`). Each `d` below
 * was fetched from the sheet the panel's own `<use href>` pointed at, parsed
 * with `DOMParser`, and read out of the matching `<symbol>` — so these are the
 * shipped paths, not redraws. The `viewBox` on each component is the one the
 * symbol declares; core icons are 20-unit, shell icons 16-unit.
 *
 * The sheet ids are kept in the comments because they are the only handle on
 * which glyph is which — the sheets carry no names.
 */

import React from 'react';

type IconProps = {
  size?: number;
  className?: string;
};

/** sprites-core#715504 — the sliders mark on the header trigger. */
export const VoiceSettingsIcon = ({ size = 20, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className={className}>
    <path
      fill="currentColor"
      d="M7.916 11.001a3.166 3.166 0 0 1 3.095 2.5h5.655l.135.014a.665.665 0 0 1 0 1.303l-.135.013h-5.655a3.166 3.166 0 0 1-6.19 0H3.334a.665.665 0 0 1 0-1.33h1.489a3.17 3.17 0 0 1 3.094-2.5m0 1.33a1.836 1.836 0 1 0 .001 3.671 1.836 1.836 0 0 0 0-3.67m4.167-9.663c1.52 0 2.79 1.072 3.095 2.5h1.488l.135.014a.665.665 0 0 1 0 1.303l-.135.013h-1.488a3.166 3.166 0 0 1-6.19 0H3.334a.665.665 0 0 1 0-1.33H8.99a3.166 3.166 0 0 1 3.094-2.5m0 1.33a1.835 1.835 0 1 0 0 3.67 1.835 1.835 0 0 0 0-3.67"
    />
  </svg>
);

/** sprites-core#85f94b — close. */
export const CloseIcon = ({ size = 20, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className={className}>
    <path
      fill="currentColor"
      d="M14.255 4.755a.7.7 0 0 1 .99.99L10.99 10l4.255 4.255.09.11a.7.7 0 0 1-.97.97l-.11-.09L10 10.99l-4.255 4.255a.7.7 0 0 1-.99-.99L9.01 10 4.755 5.745l-.09-.11a.7.7 0 0 1 .97-.97l.11.09L10 9.01z"
    />
  </svg>
);

/** sprites-core#8ee2e9 — previous voice. */
export const ChevronLeftIcon = ({ size = 20, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className={className}>
    <path
      fill="currentColor"
      d="M11.53 3.78a.666.666 0 0 1 .94.94L7.192 10l5.28 5.28.085.104a.666.666 0 0 1-.922.922l-.105-.085-5.75-5.75a.666.666 0 0 1 0-.942z"
    />
  </svg>
);

/** sprites-core#b140e7 — next voice. */
export const ChevronRightIcon = ({ size = 20, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className={className}>
    <path
      fill="currentColor"
      d="M7.53 3.78a.666.666 0 0 1 .836-.086l.105.085 5.75 5.75c.26.26.26.682 0 .942l-5.75 5.75a.666.666 0 0 1-.942-.942L12.81 10l-5.28-5.28-.085-.104a.666.666 0 0 1 .085-.837"
    />
  </svg>
);

/**
 * sprites-core#6b0d8c — the globe on the Language row.
 *
 * Declared `width="20" height="20"` upstream but carrying `icon-sm`, whose
 * 16 px wins, so it paints in a 16 px box out of a 20-unit viewBox. The default
 * here is the measured 16; the viewBox stays 20 so the glyph is not rescaled.
 */
export const GlobeIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className={className}>
    <path
      fill="currentColor"
      d="M10 2.125a7.875 7.875 0 1 1 0 15.75 7.875 7.875 0 0 1 0-15.75m-2.113 8.5c.056 1.691.338 3.188.753 4.28.233.614.495 1.068.755 1.358s.465.362.605.362.346-.073.605-.362c.26-.29.522-.744.755-1.358.415-1.092.697-2.589.753-4.28zm-4.482 0a6.63 6.63 0 0 0 4.493 5.657 7 7 0 0 1-.427-.933c-.477-1.257-.777-2.91-.834-4.724zm9.958 0c-.057 1.814-.357 3.467-.834 4.724a7 7 0 0 1-.428.933 6.63 6.63 0 0 0 4.494-5.657zm-1.262-6.908c.157.285.301.6.428.934.477 1.257.777 2.91.834 4.724h3.232A6.63 6.63 0 0 0 12.1 3.717M10 3.375c-.14 0-.346.073-.605.362-.26.29-.522.744-.755 1.358-.415 1.092-.697 2.589-.753 4.28h4.226c-.056-1.691-.338-3.188-.753-4.28-.233-.614-.495-1.068-.755-1.358s-.465-.362-.605-.362m-2.102.342a6.63 6.63 0 0 0-4.493 5.658h3.232c.057-1.814.357-3.467.834-4.724q.191-.504.427-.934"
    />
  </svg>
);

/** sprites-shell#chevron-down-sm — the combobox caret. 16-unit viewBox. */
export const ChevronDownSmIcon = ({ size = 16, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    focusable="false"
    aria-hidden="true"
    className={className}
  >
    <path
      fill="currentColor"
      d="M12.134 5.944a.666.666 0 0 1 .922.922l-.085.105-4.5 4.5a.666.666 0 0 1-.942 0l-4.5-4.5-.085-.105a.666.666 0 0 1 .922-.922l.105.085L8 10.06l4.03-4.03z"
    />
  </svg>
);

/** sprites-shell#check-sm — the tick in a selected option's trailing slot. */
export const CheckSmIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className={className}>
    <path
      fill="currentColor"
      d="M12.096 2.914a.7.7 0 0 1 1.134.772l-.069.125-6.25 9.166a.7.7 0 0 1-1.073.102l-3.75-3.75-.09-.11a.7.7 0 0 1 .97-.97l.11.09 3.153 3.152 5.774-8.469z"
    />
  </svg>
);

/** Speaker / Volume icon for voice preview. */
export const SpeakerIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className={className}>
    <path
      fill="currentColor"
      d="M10.875 3.32a.75.75 0 0 1 .875.742v11.876a.75.75 0 0 1-1.256.551L6.168 12.83H3.25A1.25 1.25 0 0 1 2 11.58V8.42c0-.69.56-1.25 1.25-1.25h2.918l4.326-3.663a.75.75 0 0 1 .381-.187ZM14.78 6.22a.75.75 0 0 1 1.06 0 5.25 5.25 0 0 1 0 7.424.75.75 0 0 1-1.06-1.06 3.75 3.75 0 0 0 0-5.304.75.75 0 0 1 0-1.06Zm2.12-2.12a.75.75 0 0 1 1.06 0 8.25 8.25 0 0 1 0 11.668.75.75 0 1 1-1.06-1.061 6.75 6.75 0 0 0 0-9.546.75.75 0 0 1 0-1.061Z"
    />
  </svg>
);


