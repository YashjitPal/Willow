import { useEffect, useRef, useState } from 'react';
import { latestThoughtHeading } from './thought-summary';
import './thought-summary.css';

export { latestThoughtHeading };

interface ThoughtSummaryLineProps {
  /** The newest heading. Changing it plays out-wipe -> swap -> in-wipe. */
  heading: string;
}

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
 */
export const ThoughtSummaryLine = ({ heading }: ThoughtSummaryLineProps) => {
  const [shown, setShown] = useState(heading);
  const [leaving, setLeaving] = useState(false);
  const pendingRef = useRef(heading);

  useEffect(() => {
    pendingRef.current = heading;
    if (heading !== shown) setLeaving(true);
  }, [heading, shown]);

  // Commit the newest pending heading, whichever path got us here. Held in a
  // ref so the backstop timer never closes over a stale `pendingRef` reader.
  const commitRef = useRef<() => void>(() => {});
  commitRef.current = () => {
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
