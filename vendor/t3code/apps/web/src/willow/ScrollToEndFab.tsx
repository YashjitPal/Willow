import { useState } from "react";

import { willowSymbol } from "./icons";

const ArrowGlyph = willowSymbol("arrow_downward");

/**
 * Willow's scroll-to-bottom button (features/chat ScrollToBottomFab, Gemini's back-to-bottom-fab),
 * styled in composer.css. Hidden it is invisible, out of the tab order and out of the
 * accessibility tree; pressed, it leaves on its quicker fade until it would be hidden anyway.
 */
export function ScrollToEndFab({
  visible,
  bottom,
  onClick,
}: {
  visible: boolean;
  bottom: number;
  onClick: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  // A press keeps its quick fade while the button hides, and is forgotten when it next appears.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setPressed(false);
  }
  const shown = visible && !pressed;
  return (
    // `bottom` reaches the composer overlay, whose own top padding (composer.css) sits above the box.
    <div
      className="willow-scroll-to-end chat-scroll-to-bottom"
      style={{ bottom: `calc(${bottom}px - var(--willow-dock-pad, 8px))` }}
    >
      <button
        type="button"
        aria-label="Scroll to end"
        aria-hidden={shown ? undefined : true}
        tabIndex={shown ? 0 : -1}
        data-willow-scroll-to-end=""
        data-visible={shown ? "" : undefined}
        data-leaving={pressed ? "" : undefined}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          setPressed(true);
          onClick();
        }}
      >
        <ArrowGlyph />
      </button>
    </div>
  );
}
