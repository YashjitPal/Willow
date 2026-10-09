// A tile's three dots for touch screens. A tile's hotbar only shows on hover, which a finger never
// gives, so on a touch screen (`hover: none`, media-responsive.css) this stays in a corner of the
// tile and opens the tile's own menu; with a mouse it is never shown (gallery-tile.css).
import React from 'react';
import { FlowIcon } from './scenes/flow-ui';

export const TouchMoreButton = React.forwardRef<HTMLButtonElement, {
  open: boolean;
  /** Toggles the menu; the button's box is the anchor for a menu below it. */
  onToggle: (rect: DOMRect) => void;
  /** Top right for tiles whose bottom edge carries their name and counts. */
  corner?: 'top' | 'bottom';
  hidden?: boolean;
}>(({ open, onToggle, corner = 'bottom', hidden }, ref) => (
  <button
    ref={ref}
    type="button"
    className={`gt-touch-more${corner === 'top' ? ' gt-touch-more--top' : ''}`}
    aria-label="More options"
    aria-expanded={open}
    style={hidden ? { visibility: 'hidden' } : undefined}
    onMouseDown={(e) => e.stopPropagation()}
    onPointerDown={(e) => e.stopPropagation()}
    onClick={(e) => {
      e.stopPropagation();
      onToggle(e.currentTarget.getBoundingClientRect());
    }}
  >
    <FlowIcon name="more_vert" size={20} />
  </button>
));
TouchMoreButton.displayName = 'TouchMoreButton';
