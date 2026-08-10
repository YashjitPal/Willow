/**
 * Inline SVGs the composer draws itself.
 *
 * These are brand/decorative marks with no lucide equivalent, so they are
 * hand-rolled rather than imported. Moved out of Composer.tsx verbatim.
 */

import React from 'react';

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
