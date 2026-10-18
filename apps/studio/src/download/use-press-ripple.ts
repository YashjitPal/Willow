import { useRef } from 'react';
import type React from 'react';
import { launchMaterialRipple } from '@willow/chat/material-ripple';

/**
 * A Material ripple for a press, released when the press ends however it ends. It grows from the
 * press point, or from the middle for icon buttons (`centred`), as Gemini's do.
 */
export const usePressRipple = (className: string, centred = false) => {
  const ripplesRef = useRef<HTMLSpanElement>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  const end = () => {
    releaseRef.current?.();
    releaseRef.current = null;
  };
  const start = (event: React.PointerEvent) => {
    if (event.button !== 0 || !ripplesRef.current) return;
    end();
    const box = ripplesRef.current.getBoundingClientRect();
    const x = centred ? box.left + box.width / 2 : event.clientX;
    const y = centred ? box.top + box.height / 2 : event.clientY;
    releaseRef.current = launchMaterialRipple(ripplesRef.current, className, x, y);
  };
  return { ripplesRef, handlers: { onPointerDown: start, onPointerUp: end, onPointerLeave: end, onPointerCancel: end } };
};
