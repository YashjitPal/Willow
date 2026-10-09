import { useEffect, useState } from 'react';
import { TooltipOverlay } from '@willow/ui/Tooltip';
import { onDesktopMessage } from '@willow/core/desktop-bridge';

/*
 * The strip's tooltips (apps/desktop/shell/tabs.html), drawn here as Willow's own under the
 * button they belong to: the strip is 40px with no room below it, as for its menus (AppMenu).
 * The tooltip's anchor is the button's span of the strip, just above this page's top edge, so
 * Willow's tooltip sits under it as under any of Willow's buttons.
 */

interface Tip {
  text: string;
  left: number;
  width: number;
}

export function StripTooltip() {
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => onDesktopMessage((message) => {
    if (message.kind !== 'strip-tooltip') return;
    if (message.text === null) {
      setShown(false);
      return;
    }
    // The strip says where in device pixels: it and this page may be zoomed apart.
    const scale = window.devicePixelRatio;
    setTip({ text: message.text, left: message.left / scale, width: (message.right - message.left) / scale });
    setShown(true);
  }), []);

  return (
    <>
      <div
        ref={setAnchor}
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: -40,
          left: tip?.left ?? 0,
          width: tip?.width ?? 0,
          height: 40,
          pointerEvents: 'none',
          visibility: 'hidden',
        }}
      />
      {/* Remounted per tooltip, so moving between buttons plays the show again, as Willow's do. */}
      <TooltipOverlay key={tip?.text} anchor={anchor} content={tip?.text ?? ''} position="below" open={shown && tip !== null} />
    </>
  );
}
