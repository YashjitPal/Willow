/**
 * Gemini's "Scroll to bottom" arrow, as its service decides it (read out of Gemini's bundle;
 * captures in tools/ui-research/captures/gemini/scroll-to-bottom/):
 *
 * - it shows while the newest content runs at least 200px past the bottom of the view. Gemini
 *   measures to the content, not to the end of the scroller, because the turn on screen holds
 *   space open under its reply; within 200px of the scroller's end it never shows;
 * - pressed, it hides at once and the thread glides to its end, and it stays hidden until the
 *   view is back within reach of the end;
 * - while a reply is coming in it stays hidden, unless the user scrolls up during it.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export const SCROLL_TO_BOTTOM_THRESHOLD = 200;

/** How far the newest content runs past the view's bottom edge; 0 within 200px of the end. */
export const contentBelowView = ({
  scrollHeight,
  clientHeight,
  scrollTop,
  contentBottom,
  viewBottom,
}: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
  /** The newest content's bottom edge, in viewport px, or null when there is none to measure. */
  contentBottom: number | null;
  viewBottom: number;
}): number => {
  const fromEnd = scrollHeight - clientHeight - scrollTop;
  if (fromEnd < SCROLL_TO_BOTTOM_THRESHOLD) return 0;
  if (contentBottom === null) return fromEnd;
  return Math.max(0, contentBottom - viewBottom);
};

export const useScrollToBottom = ({
  scrollerRef,
  contentBottom,
  bottomInset,
  empty,
  replying,
}: {
  scrollerRef: RefObject<HTMLElement | null>;
  contentBottom: () => number | null;
  /** The strip along the scroller's bottom that something sits over (Spark's composer). */
  bottomInset?: () => number;
  empty: boolean;
  /** A reply is streaming in or still being revealed. */
  replying: boolean;
}) => {
  const [below, setBelow] = useState(0);
  // Pressed: hidden until the view is back within reach of the end.
  const [pressed, setPressed] = useState(false);
  // A reply coming in, and the user has not scrolled up since it started.
  const [following, setFollowing] = useState(false);
  const replyingRef = useRef(replying);
  const lastTopRef = useRef(0);
  const contentBottomRef = useRef(contentBottom);
  const bottomInsetRef = useRef(bottomInset);
  contentBottomRef.current = contentBottom;
  bottomInsetRef.current = bottomInset;

  useEffect(() => {
    replyingRef.current = replying;
    setFollowing(replying);
  }, [replying]);

  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const next = contentBelowView({
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      scrollTop: scroller.scrollTop,
      contentBottom: contentBottomRef.current(),
      viewBottom: scroller.getBoundingClientRect().bottom - (bottomInsetRef.current?.() ?? 0),
    });
    setBelow((current) => (current === next ? current : next));
    if (next < SCROLL_TO_BOTTOM_THRESHOLD) setPressed(false);
  }, [scrollerRef]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    };
    lastTopRef.current = scroller.scrollTop;
    const onScroll = () => {
      const top = scroller.scrollTop;
      if (replyingRef.current && top < lastTopRef.current - 1) setFollowing(false);
      lastTopRef.current = top;
      schedule();
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    // A reply growing, or the composer resizing the view, moves the content without a scroll.
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    measure();
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [scrollerRef, measure, empty]);

  const scrollToBottom = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    setPressed(true);
    scroller.scrollTo({ top: scroller.scrollHeight - scroller.clientHeight, behavior: 'smooth' });
  }, [scrollerRef]);

  return {
    visible: !empty && !pressed && !following && below >= SCROLL_TO_BOTTOM_THRESHOLD,
    scrollToBottom,
  };
};
