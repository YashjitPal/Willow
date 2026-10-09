import React, { useCallback, useEffect, useRef } from 'react';

const HOLD_MS = 500;
/** How far a finger may drift before the press counts as the start of a scroll. */
const SLOP_PX = 10;
/** A browser sends the click for a lifted finger straight after its pointerup. */
const CLICK_AFTER_RELEASE_MS = 400;

/**
 * A press held still for half a second on a touch screen: a tile's way into its menu where there
 * is no right button. Chrome on Android turns such a press into `contextmenu` by itself, iOS
 * Safari never does, so this fires on its own timer; `justFired` lets a `contextmenu` handler drop
 * the duplicate. The click the finger sends on lifting would land on whatever the press opened,
 * a sheet's backdrop most likely, so it is swallowed before anything sees it.
 *
 * A mouse or pen is left alone: they have the right button and the browser's own menu. The
 * callback gets the element pressed, so one handler can serve a whole row of things.
 */
export function useLongPress(onLongPress: (x: number, y: number, target: Element) => void) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const firedAt = useRef(0);
  const callback = useRef(onLongPress);
  callback.current = onLongPress;

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    cancel();
    const { clientX: x, clientY: y, pointerId } = event;
    const target = event.target instanceof Element ? event.target : event.currentTarget;
    origin.current = { x, y };
    timer.current = window.setTimeout(() => {
      timer.current = null;
      origin.current = null;
      firedAt.current = Date.now();
      swallowClickAfterRelease(pointerId);
      callback.current(x, y, target);
    }, HOLD_MS);
  }, [cancel]);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const start = origin.current;
    if (!start || event.pointerType !== 'touch') return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > SLOP_PX) cancel();
  }, [cancel]);

  const justFired = useCallback(() => Date.now() - firedAt.current < HOLD_MS, []);
  /** A finger is down and still: a `contextmenu` now is Android's long press, not a right-click. */
  const isPressing = useCallback(() => origin.current !== null, []);

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp: cancel, onPointerCancel: cancel },
    justFired,
    isPressing,
    cancel,
  };
}

/**
 * Drops the click that follows this pointer's release, however long it was held. Window capture
 * runs before React's root listener, so nothing in the app sees that click.
 */
function swallowClickAfterRelease(pointerId: number) {
  const stopWatching = () => {
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
  };
  const onCancel = (event: PointerEvent) => {
    if (event.pointerId === pointerId) stopWatching();
  };
  const onUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    stopWatching();
    const swallow = (click: Event) => {
      window.removeEventListener('click', swallow, true);
      click.preventDefault();
      click.stopPropagation();
    };
    window.addEventListener('click', swallow, true);
    window.setTimeout(() => window.removeEventListener('click', swallow, true), CLICK_AFTER_RELEASE_MS);
  };
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
}
