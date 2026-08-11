/**
 * Anchor selection for the chat thread's scroll pin.
 *
 * Its own module because it is pure geometry over a DOM subtree, and the
 * alternative — a closure inside ChatView — can only be tested by asserting on
 * its source text. The branching here (straddle vs. next-below, the inline stop,
 * the depth cap) is exactly the kind that fails quietly: a wrong pick still pins
 * *something*, so the panel transition looks improved while the case the pin was
 * built for keeps sliding.
 */

/**
 * The deepest block-level box inside `container` that crosses the viewport line
 * `refY`.
 *
 * Granularity is the whole point. The message wrapper is too coarse for the case
 * this exists for — ONE long reply re-wrapping — because the growth happens
 * inside that wrapper, above the line being read, while the wrapper's own top
 * never moves. Pinning it would hold a position nothing was drifting from.
 * Descending finds the paragraph instead.
 *
 * It stops at block boundaries rather than walking on into inline content: a
 * word span is a worse anchor than its paragraph, not a better one. Re-wrap
 * moves words between lines deliberately, so pinning one would fight the reflow
 * the reader asked to keep, and jitter by a line-height while doing it.
 *
 * `displayOf` is injected so this can run against a plain-object DOM in a test;
 * the default is the real thing.
 */
export const findDeepBlockAnchor = (
  container: Element,
  refY: number,
  displayOf: (element: Element) => string = (element) => getComputedStyle(element).display,
): Element | null => {
  let anchor: Element | null = null;
  let node: Element = container;
  // Bounded rather than exhaustive: a reply nests a handful of levels
  // (thread -> turn -> wrapper -> prose -> block) and this walks one path down.
  for (let depth = 0; depth < 12; depth += 1) {
    let straddling: Element | null = null;
    let firstBelow: Element | null = null;
    for (const child of Array.from(node.children)) {
      const rect = child.getBoundingClientRect();
      // Zero-height boxes are collapsed or hidden; a rect that reads all zeros
      // also means a detached node, which must never win the walk.
      if (rect.height === 0) continue;
      // Half-pixel slack because a box sitting flush with the scrollport edge
      // lands either side of it depending on fractional scroll position. This
      // only changes which BRANCH claims the box, not which box is returned —
      // in a top-to-bottom flow the same element is the next-below candidate a
      // fraction later. Kept because the two branches are read as a pair.
      if (rect.top - 0.5 <= refY && rect.bottom > refY) { straddling = child; break; }
      if (!firstBelow && rect.top > refY) firstBelow = child;
    }
    // Nothing crosses the line when it falls in a gap between messages. The next
    // box down is what the reader is about to be looking at, and holding it
    // still holds the gap above it still too.
    const next = straddling ?? firstBelow;
    if (!next) break;
    // One style read per level, not per child: the thread column's child list is
    // the whole revealed history, and only the chosen path is ever descended.
    const display = displayOf(next);
    if (display === 'inline' || display === 'contents') break;
    anchor = next;
    node = next;
  }
  return anchor;
};
