/**
 * Gemini's `back-to-bottom-fab`: a 40px round arrow centred over the composer, 36px above it.
 * Hidden it is invisible, out of the tab order and out of the accessibility tree; pressed, it
 * leaves on a 0.1s fade instead of its 0.2s one, until it would be hidden anyway.
 *
 * Its parent is the composer's box, which has to be `position: relative`.
 */
import React, { useEffect, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import './ScrollToBottomFab.css';

export const ScrollToBottomFab: React.FC<{ visible: boolean; onClick: () => void }> = ({ visible, onClick }) => {
  const [pressed, setPressed] = useState(false);
  useEffect(() => {
    if (!visible) setPressed(false);
  }, [visible]);
  const shown = visible && !pressed;
  return (
    <div className="gm-back-to-bottom">
      <button
        type="button"
        className={`gm-back-to-bottom__button${shown ? ' is-visible' : ''}${pressed ? ' is-leaving' : ''}`}
        aria-label="Scroll to bottom"
        aria-hidden={shown ? undefined : true}
        tabIndex={shown ? 0 : -1}
        onClick={() => {
          setPressed(true);
          onClick();
        }}
      >
        <MaterialSymbol
          family="google-symbols"
          name="arrow_downward"
          size={20}
          weight={320}
          variationSettings={'"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 20, "wght" 320'}
        />
      </button>
    </div>
  );
};
