import React from 'react';

/**
 * The diagonal bar ChatGPT draws across its mic glyph when the mic is muted.
 *
 * Taken verbatim from the `#ee832a` symbol in ChatGPT's sprite sheet
 * (`/cdn/assets/sprites-core-f290a825.svg`, `viewBox="0 0 20 20"`), whose
 * opening commands are:
 *
 *   M2.35 2.352 a.8.8 0 0 1 1.132 0 l14.167 14.166 a.8.8 0 0 1-1.132 1.131
 *
 * Those two quarter-arcs are the halves of a round cap, so the shape is a
 * stroked line: solving each arc for the centre equidistant (r = 0.8) from its
 * endpoints puts the caps at (2.916, 2.9174) and (17.083, 17.0835), giving a
 * 1.6-wide round-capped bar at 44.998° — reproduced here as a stroke rather
 * than re-tracing the outline as a filled path.
 *
 * ChatGPT redraws its whole mic glyph around this bar so the two read as one
 * union with no separating gap. We keep Willow's own mic icon and lay the bar
 * over it in the same colour, which produces that same seamless union without
 * touching the glyph — the button's `currentColor` drives both.
 */
export const MicMutedSlash: React.FC<{ size: number; className?: string }> = ({ size, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden="true"
    focusable="false"
    className={className}
  >
    <line
      x1={2.916}
      y1={2.9174}
      x2={17.083}
      y2={17.0835}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
    />
  </svg>
);
