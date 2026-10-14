/**
 * A sent message's way to the top, as Willow's chat moves it (features/chat ChatView's
 * runTurnEntrance): the turn is drawn low by the blank space under it and eased home while the
 * thread scrolls, on one timeline, so the bubble rises from the box and slows into place without
 * a seam between the glide and the scroll. 240ms plus 0.28ms a pixel, at most 520ms, on Willow's
 * emphasised curve; a wheel, touch or key hands the turn back over 120ms.
 */

/** cubic-bezier(0.2, 0, 0, 1), sampled in JS because a transform and a scroll share it. */
export function sampleEmphasisedEase(t: number): number {
  const axis = (c1: number, c2: number, u: number) => {
    const a = 3 * c1;
    const b = 3 * (c2 - c1) - a;
    const c = 1 - a - b;
    return ((c * u + b) * u + a) * u;
  };
  const axisSlope = (c1: number, c2: number, u: number) => {
    const a = 3 * c1;
    const b = 3 * (c2 - c1) - a;
    const c = 1 - a - b;
    return (3 * c * u + 2 * b) * u + a;
  };
  let u = t;
  for (let i = 0; i < 5; i += 1) {
    const slope = axisSlope(0.2, 0, u);
    if (Math.abs(slope) < 1e-6) break;
    u -= (axis(0.2, 0, u) - t) / slope;
  }
  return axis(0, 1, Math.min(1, Math.max(0, u)));
}

export function turnEntranceDurationMs(distance: number): number {
  return Math.min(520, Math.max(240, 240 + distance * 0.28));
}

const HANDOVER_MS = 120;

/** Where the entrance brings a sent message, at once: an opened chat lands there. */
export function placeTurnAnchor(
  scrollNode: HTMLElement,
  anchorItem: HTMLElement,
  viewOffset: number,
): void {
  const anchorInView =
    anchorItem.getBoundingClientRect().top - scrollNode.getBoundingClientRect().top;
  scrollNode.scrollTop = Math.max(
    0,
    Math.min(
      scrollNode.scrollTop + anchorInView - viewOffset,
      scrollNode.scrollHeight - scrollNode.clientHeight,
    ),
  );
}

/**
 * Starts the entrance and returns its cancel. `anchorItem` is the list's own item holding the
 * sent message, never transformed itself: its frame and every frame after it are, including
 * rows that mount mid-flight, so a reply arriving early rides with the bubble.
 */
export function runTurnEntrance(input: {
  readonly scrollNode: HTMLElement;
  readonly anchorItem: HTMLElement;
  readonly viewOffset: number;
  readonly isCurrent: () => boolean;
  readonly onSettled: () => void;
}): () => void {
  const { scrollNode, anchorItem } = input;
  const startTop = scrollNode.scrollTop;
  const anchorInView = () =>
    anchorItem.getBoundingClientRect().top - scrollNode.getBoundingClientRect().top;
  // Where the anchor sits now, read every frame: the reserve settles as the reply arrives.
  const liveTarget = () =>
    Math.max(
      0,
      Math.min(
        scrollNode.scrollTop + anchorInView() - input.viewOffset,
        scrollNode.scrollHeight - scrollNode.clientHeight,
      ),
    );
  const offset = Math.max(0, Math.round(scrollNode.clientHeight - anchorInView()));
  const total = offset + Math.max(0, liveTarget() - startTop);
  const duration = turnEntranceDurationMs(total);

  const entering = () =>
    [...scrollNode.querySelectorAll<HTMLElement>(".messages-timeline-row-frame")].filter(
      (frame) => (frame.parentElement?.offsetTop ?? -1) >= anchorItem.offsetTop,
    );
  const draw = (value: number) => {
    for (const frame of entering()) {
      frame.style.transform = value > 0 ? `translateY(${value}px)` : "";
    }
  };

  let frame: number | null = null;
  let currentOffset = offset;
  let done = false;
  const detach = () => {
    scrollNode.removeEventListener("wheel", interrupt);
    scrollNode.removeEventListener("touchstart", interrupt);
    scrollNode.removeEventListener("keydown", interrupt);
  };
  const finish = () => {
    if (done) return;
    done = true;
    detach();
    draw(0);
    if (input.isCurrent()) input.onSettled();
  };
  // A wheel tick or a drag means the reader has taken over: hand the offset back over a short
  // settle rather than teleporting the turn up by what is left of it.
  function interrupt() {
    if (done || frame === null) return;
    cancelAnimationFrame(frame);
    const from = currentOffset;
    const start = performance.now();
    const settle = (now: number) => {
      const t = Math.min(1, (now - start) / HANDOVER_MS);
      draw(from * (1 - sampleEmphasisedEase(t)));
      frame = t >= 1 ? null : requestAnimationFrame(settle);
      if (t >= 1) finish();
    };
    frame = requestAnimationFrame(settle);
    detach();
  }
  scrollNode.addEventListener("wheel", interrupt, { passive: true });
  scrollNode.addEventListener("touchstart", interrupt, { passive: true });
  scrollNode.addEventListener("keydown", interrupt);

  // Drawn low before the first paint, so the bubble never shows at its resting place first.
  draw(offset);
  const start = performance.now();
  const step = (now: number) => {
    if (!input.isCurrent()) {
      frame = null;
      done = true;
      detach();
      draw(0);
      return;
    }
    const progress = Math.min(1, (now - start) / duration);
    const travelled = total * sampleEmphasisedEase(progress);
    // The offset first, then the scroll: the bubble crosses the blank space and only then
    // pushes the thread.
    currentOffset = Math.max(0, offset - travelled);
    draw(progress >= 1 ? 0 : currentOffset);
    const scrollLeg = Math.max(0, total - offset);
    const scrollEased =
      scrollLeg === 0 ? 1 : Math.min(1, Math.max(0, travelled - offset) / scrollLeg);
    const destination = liveTarget();
    const next =
      destination <= startTop ? startTop : startTop + (destination - startTop) * scrollEased;
    // Never rewind: this only travels down the thread.
    if (next > scrollNode.scrollTop) scrollNode.scrollTop = next;
    if (progress < 1) {
      frame = requestAnimationFrame(step);
    } else {
      frame = null;
      finish();
    }
  };
  frame = requestAnimationFrame(step);
  return () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    done = true;
    detach();
    draw(0);
  };
}
