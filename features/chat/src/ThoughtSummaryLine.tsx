import { useEffect, useRef, useState } from 'react';
import { latestThoughtHeading } from './thought-summary';
import './thought-summary.css';

export { latestThoughtHeading };

interface ThoughtSummaryLineProps {
  /** The newest heading. Gemini samples it after a minimum visible hold. */
  heading: string;
}

const MINIMUM_HEADING_HOLD_MS = 3000;

/**
 * Gemini's one-line thought summary, with its exact wipe.
 *
 * A line change is TWO halves, not one — established from a MutationObserver
 * record of five real transitions in the live app. The node gains
 * `animated-content-off` (which inverts the mask gradient so the text is
 * hidden rather than revealed), then loses it again as the text swaps.
 * Measured gaps between the two class flips: 346, 346, 378, 363, 363 ms,
 * against a 350ms animation — so Gemini swaps when the out-wipe *finishes*,
 * not on an independent timer.
 *
 * This mirrors that by listening for `animationend` rather than racing a
 * setTimeout, which also means a dropped frame delays the swap instead of
 * tearing it. The timeout is only a backstop for when no animation event can
 * arrive at all — under `prefers-reduced-motion` the animation is `none`, and
 * a never-resolving `leaving` state would otherwise freeze the line forever.
 *
 * The first heading of a generation only wipes in: Gemini has no preceding
 * text to wipe out, and neither do we, because `shown` is seeded from the
 * first `heading` rather than from empty.
 *
 * Gemini also holds each displayed heading for about three seconds. A live
 * timestamped capture received six headings at 0ms, 1181ms, 2006ms, 2848ms,
 * 3606ms and 4305ms. The UI showed heading 1 immediately, began its out-wipe at
 * 2983ms, and swapped directly to heading 4 when that wipe ended. Headings 2
 * and 3 never painted; 5 and 6 arrived during the next hold and the response
 * ended before another swap. This is latest-only sampling, not a FIFO queue.
 */
export const ThoughtSummaryLine = ({ heading }: ThoughtSummaryLineProps) => {
  const [shown, setShown] = useState(heading);
  const [leaving, setLeaving] = useState(false);
  const pendingRef = useRef(heading);
  const shownAtRef = useRef(performance.now());
  const holdTimerRef = useRef<number | null>(null);

  const beginLeavingRef = useRef<() => void>(() => {});
  beginLeavingRef.current = () => {
    if (leaving || pendingRef.current === shown) return;

    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    const remaining = MINIMUM_HEADING_HOLD_MS - (performance.now() - shownAtRef.current);
    if (remaining > 0) {
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = null;
        beginLeavingRef.current();
      }, remaining);
      return;
    }

    setLeaving(true);
  };

  useEffect(() => {
    pendingRef.current = heading;
    beginLeavingRef.current();
  }, [heading, shown, leaving]);

  useEffect(() => () => {
    if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
  }, []);

  // Commit the newest pending heading, whichever path got us here. Held in a
  // ref so the backstop timer never closes over a stale `pendingRef` reader.
  const commitRef = useRef<() => void>(() => {});
  commitRef.current = () => {
    shownAtRef.current = performance.now();
    setShown(pendingRef.current);
    setLeaving(false);
  };

  useEffect(() => {
    if (!leaving) return;
    // 350ms animation plus a frame, matching the measured 346-378ms.
    const backstop = window.setTimeout(() => commitRef.current(), 380);
    return () => window.clearTimeout(backstop);
  }, [leaving]);

  return (
    <span
      // A fresh element per phase. Both animations are `fill: forwards`, so
      // without a remount a finished wipe would sit at its end state and never
      // replay. The two key spaces cannot collide: one is exactly 'out', the
      // other always carries the 'in:' prefix.
      key={leaving ? 'out' : `in:${shown}`}
      className={`thought-summary-line${leaving ? ' thought-summary-line--out' : ''}`}
      onAnimationEnd={leaving ? () => commitRef.current() : undefined}
    >
      {shown}
    </span>
  );
};
