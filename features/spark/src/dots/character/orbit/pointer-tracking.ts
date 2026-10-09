export type GazeMessage =
  | { type: "orbit-character-pointer"; x: number; y: number; bounds: DOMRect }
  | { type: "orbit-character-pointer-cancel" };

export interface GestureMessage {
  type: "orbit-character-gesture";
  phase: "down" | "move" | "up" | "cancel";
  id: number;
  x: number;
  y: number;
}

const GAZE_HOLD_MS = 10000;
const DRAG_THRESHOLD_PX = 6;

/**
 * Follows the mouse while it hovers `hoverTarget` (and for ten seconds after it leaves),
 * reporting positions relative to `frameElement`.
 */
export function trackCharacterGaze(
  hoverTarget: Element,
  hitElement: Element,
  frameElement: Element,
  send: (message: GazeMessage) => void,
) {
  let hovering = false;
  let holdTimeout: number | undefined;

  function release() {
    if (holdTimeout != null) {
      window.clearTimeout(holdTimeout);
      holdTimeout = undefined;
      send({ type: "orbit-character-pointer-cancel" });
    }
  }

  function reset() {
    hovering = false;
    release();
  }

  function onPointerMove(event: PointerEvent) {
    if (!event.isPrimary || event.pointerType === "touch") return;
    const hitRect = hitElement.getBoundingClientRect();
    const inside =
      event.composedPath().includes(hoverTarget) &&
      hitRect.width > 0 &&
      hitRect.height > 0 &&
      event.clientX >= hitRect.left &&
      event.clientX <= hitRect.right &&
      event.clientY >= hitRect.top &&
      event.clientY <= hitRect.bottom;
    if (inside && !hovering) {
      window.clearTimeout(holdTimeout);
      holdTimeout = window.setTimeout(release, GAZE_HOLD_MS);
    }
    hovering = inside;
    const bounds = frameElement === hitElement ? hitRect : frameElement.getBoundingClientRect();
    if (holdTimeout != null && bounds.width > 0 && bounds.height > 0) {
      send({
        type: "orbit-character-pointer",
        x: (event.clientX - bounds.left) / bounds.width,
        y: (event.clientY - bounds.top) / bounds.height,
        bounds,
      });
    }
  }

  function onVisibilityChange() {
    if (document.hidden) reset();
  }

  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("blur", reset);
  document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    reset();
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("blur", reset);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

/** Forwards drags on `target` to the frame as gestures and calls `onTap` for clicks. */
export function trackCharacterGestures(
  target: HTMLElement,
  frameElement: Element,
  send: (message: GestureMessage) => void,
  onTap: () => void,
  allowDrag = true,
) {
  let drag: { id: number; x: number; y: number; distance: number } | undefined;
  let tapped = false;

  function sendGesture(phase: GestureMessage["phase"], event: PointerEvent) {
    const rect = frameElement.getBoundingClientRect();
    if (rect.width && rect.height) {
      send({
        type: "orbit-character-gesture",
        phase,
        id: event.pointerId,
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
      });
    }
  }

  function cancel() {
    tapped = false;
    if (!drag) return;
    const id = drag.id;
    drag = undefined;
    send({ type: "orbit-character-gesture", phase: "cancel", id, x: 0, y: 0 });
    if (target.hasPointerCapture(id)) target.releasePointerCapture(id);
  }

  function onPointerDown(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0 || drag) {
      cancel();
      return;
    }
    tapped = false;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0 };
    target.setPointerCapture(event.pointerId);
    if (allowDrag) sendGesture("down", event);
  }

  function measure(event: PointerEvent) {
    if (drag) drag.distance = Math.max(drag.distance, Math.hypot(event.clientX - drag.x, event.clientY - drag.y));
  }

  function onPointerMove(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    for (const coalesced of event.getCoalescedEvents?.() ?? []) {
      measure(coalesced);
      if (allowDrag && drag.distance > DRAG_THRESHOLD_PX) sendGesture("move", coalesced);
    }
    measure(event);
    if (allowDrag && drag.distance > DRAG_THRESHOLD_PX) sendGesture("move", event);
  }

  function onPointerUp(event: PointerEvent) {
    if (drag?.id !== event.pointerId) return;
    measure(event);
    const rect = target.getBoundingClientRect();
    tapped =
      event.button === 0 &&
      drag.distance <= DRAG_THRESHOLD_PX &&
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (allowDrag && drag.distance > DRAG_THRESHOLD_PX) sendGesture("move", event);
    drag = undefined;
    if (allowDrag) sendGesture("up", event);
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  }

  function onLostPointerCapture(event: PointerEvent) {
    if (drag?.id === event.pointerId) cancel();
  }

  function onClick(event: MouseEvent) {
    const isTap = event.button === 0 && (event.detail === 0 || tapped);
    tapped = false;
    if (isTap) onTap();
  }

  function onVisibilityChange() {
    if (document.hidden) cancel();
  }

  target.addEventListener("pointerdown", onPointerDown, true);
  target.addEventListener("pointermove", onPointerMove, true);
  target.addEventListener("pointerup", onPointerUp, true);
  target.addEventListener("pointercancel", cancel, true);
  target.addEventListener("lostpointercapture", onLostPointerCapture, true);
  target.addEventListener("click", onClick, true);
  window.addEventListener("blur", cancel);
  document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    cancel();
    target.removeEventListener("pointerdown", onPointerDown, true);
    target.removeEventListener("pointermove", onPointerMove, true);
    target.removeEventListener("pointerup", onPointerUp, true);
    target.removeEventListener("pointercancel", cancel, true);
    target.removeEventListener("lostpointercapture", onLostPointerCapture, true);
    target.removeEventListener("click", onClick, true);
    window.removeEventListener("blur", cancel);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
