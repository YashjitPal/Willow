import type { PointerEvent } from "react";

/** `m_1.pressableScaleMultiplier` (helpers chunk config). */
const pressableScaleMultiplier = 1;

/** `st` (helpers chunk): on pointer enter, sets the element's pressed `--scale` from its width. */
export function setPressableScale(event: PointerEvent<HTMLElement>) {
  const element = event.currentTarget;
  if (!(element instanceof HTMLElement)) return;
  const width = element.offsetWidth;
  let scale = 0.985;
  if (width <= 80) scale = 0.96;
  else if (width <= 150) scale = 0.97;
  else if (width <= 220) scale = 0.98;
  else if (width > 600) scale = 0.995;
  element.style.setProperty("--scale", (1 + (scale - 1) * pressableScaleMultiplier).toString());
}
