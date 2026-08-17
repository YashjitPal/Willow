/**
 * Where to put the floating edit prompt so it stays inside the preview.
 *
 * Pure geometry, deliberately kept out of the overlay: the prompt box is
 * rendered by a `motion.div` that is a direct child of an `AnimatePresence`,
 * and moving THAT into another component would silently break its exit
 * animation. Only the arithmetic moved — the markup did not.
 *
 * Takes the ref rather than the element so the body is unchanged from the
 * original inline version.
 */

import type { RefObject } from 'react';

// Constants for prompt box sizing
const PROMPT_BOX_HEIGHT = 60;
const EDGE_PADDING = 12;

/**
 * Only the three fields the maths needs, so the overlay keeps ownership of its
 * own `ElementInfo` type.
 */
interface PromptAnchor {
  x: number;
  y: number;
  height: number;
}

export const computePromptBoxPosition = (
  primaryElement: PromptAnchor,
  iframeRef: RefObject<HTMLIFrameElement>,
): { left: number; top: number } => {
  // Calculate optimal position for the prompt box
  let viewportWidth = window.innerWidth;
  let viewportHeight = window.innerHeight;

  if (iframeRef.current) {
    const rect = iframeRef.current.getBoundingClientRect();
    viewportWidth = rect.width;
    viewportHeight = rect.height;
  }

  // Use a safe estimate for the box width (slightly larger than actual to be safe)
  const SAFE_BOX_WIDTH = 420;

  // Default: align left edge with selection, position below
  let left = primaryElement.x;
  let top = primaryElement.y + primaryElement.height + 10;

  // Clamp left position to keep prompt fully visible
  const minLeft = EDGE_PADDING;
  const maxLeft = viewportWidth - SAFE_BOX_WIDTH - EDGE_PADDING;

  // Ensure strictly bounded
  left = Math.max(minLeft, Math.min(left, maxLeft));

  // Handle vertical positioning
  const belowWorks = top + PROMPT_BOX_HEIGHT <= viewportHeight - EDGE_PADDING;
  const aboveTop = primaryElement.y - PROMPT_BOX_HEIGHT - 10;
  const aboveWorks = aboveTop >= EDGE_PADDING;

  if (!belowWorks) {
    if (aboveWorks) {
      // Position above the selection
      top = aboveTop;
    } else {
      // Neither above nor below works - position ON the selection (centered)
      top = primaryElement.y + (primaryElement.height / 2) - (PROMPT_BOX_HEIGHT / 2);
      // Clamp to viewport
      top = Math.max(EDGE_PADDING, Math.min(top, viewportHeight - PROMPT_BOX_HEIGHT - EDGE_PADDING));
    }
  }

  return { left, top };
};
