import { useEffect, useRef, useState } from "react";

/*
 * A streaming reply reveals as Willow's does (platform/ui streaming-text-reveal.ts and
 * StreamingMarkdown): incoming text waits in a pending suffix and is shown a sentence or a
 * paragraph at a time once one has arrived, else a few words at a time, every 50 to 320ms by how
 * much it adds, catching up after the stream ends. The words it adds then fade in
 * (willow/streamWords.ts).
 */

const STREAM_REVEAL_MIN_INTERVAL_MS = 50;
const STREAM_REVEAL_MAX_INTERVAL_MS = 320;

const includeTrailingWhitespace = (source: string, end: number): number => {
  let cursor = end;
  while (cursor < source.length && /\s/.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
};

const semanticBoundaryFor = (suffix: string): number => {
  const paragraphBreak = /\n{2,}/.exec(suffix);
  const sentenceEnd = /[.!?](?:["')\]]+)?(?=\s|$)/.exec(suffix);
  const paragraphEnd = paragraphBreak
    ? paragraphBreak.index + paragraphBreak[0].length
    : Number.POSITIVE_INFINITY;
  const sentenceBoundary = sentenceEnd
    ? sentenceEnd.index + sentenceEnd[0].length
    : Number.POSITIVE_INFINITY;
  return Math.min(paragraphEnd, sentenceBoundary);
};

const wordBudgetFor = (backlogLength: number): number => {
  if (backlogLength <= 36) return 2;
  if (backlogLength <= 96) return 4;
  if (backlogLength <= 240) return 8;
  if (backlogLength <= 520) return 12;
  if (backlogLength <= 1_200) return 18;
  return 28;
};

/** The next visible prefix's length: a whole sentence or paragraph when one is waiting. */
export function nextStreamingRevealLength(source: string, visibleLength: number): number {
  const from = Math.max(0, Math.min(visibleLength, source.length));
  if (from >= source.length) return source.length;
  const suffix = source.slice(from);
  const semanticBoundary = semanticBoundaryFor(suffix);
  if (Number.isFinite(semanticBoundary)) {
    return Math.min(source.length, from + includeTrailingWhitespace(suffix, semanticBoundary));
  }
  const budget = wordBudgetFor(suffix.length);
  const words = /\S+\s*/g;
  let end = 0;
  for (let count = 0; count < budget; count += 1) {
    const match = words.exec(suffix);
    if (!match) break;
    end = match.index + match[0].length;
  }
  // A partial token with no whitespace must not wait forever for its boundary.
  return end > 0 ? Math.min(source.length, from + end) : source.length;
}

/** The pause before the next step, longer the more it adds. */
export function nextStreamingRevealDelayMs(source: string, visibleLength: number): number {
  const introduced = Math.max(0, nextStreamingRevealLength(source, visibleLength) - visibleLength);
  return Math.max(
    STREAM_REVEAL_MIN_INTERVAL_MS,
    Math.min(STREAM_REVEAL_MAX_INTERVAL_MS, Math.round(36 + introduced * 1.6)),
  );
}

/**
 * The shown prefix kept while the source only grows; a reply that was replaced starts its reveal
 * afresh, and one that shrank shows what is left.
 */
export function reconcileStreamingReveal(visible: string, source: string): string {
  if (source.startsWith(visible)) return visible;
  if (visible.startsWith(source)) return source;
  return "";
}

/** A reveal is paced on a page, and not where its reader asked for reduced motion. */
const pacedHere = () =>
  typeof window !== "undefined" &&
  !(
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

/** What of `text` to show while it streams, and whether the reveal is still catching up. */
export function useStreamReveal(
  text: string,
  streaming: boolean,
): { readonly shown: string; readonly revealing: boolean } {
  const [paced] = useState(pacedHere);
  const [revealing, setRevealing] = useState(paced && streaming);
  // What had arrived before the row mounted shows at once: the timeline remounts rows it scrolls
  // past, and a reply coming back into view must not start its reveal over.
  const [shown, setShown] = useState(text);
  const visible = revealing ? reconcileStreamingReveal(shown, text) : text;
  if (paced && streaming && !revealing) setRevealing(true);
  // Once the stream has ended and the reveal has caught up, the text shows as it is.
  if (revealing && !streaming && visible === text) {
    setRevealing(false);
    setShown(text);
  }
  const latestText = useRef(text);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latestText.current = text;
  }, [text]);

  // Clearing the timer clears its handle too, or StrictMode's second mount would wait on a
  // promotion it had just cancelled.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  useEffect(() => {
    // A step already waiting keeps its time, or tokens arriving faster than the cadence would
    // put it off until the stream ends.
    if (!revealing || visible === text || timer.current !== null) return;
    timer.current = setTimeout(
      () => {
        timer.current = null;
        setShown((current) => {
          const source = latestText.current;
          const reconciled = reconcileStreamingReveal(current, source);
          if (reconciled !== current) return reconciled;
          return source.slice(0, nextStreamingRevealLength(source, current.length));
        });
      },
      nextStreamingRevealDelayMs(text, visible.length),
    );
  }, [revealing, text, visible]);

  return { shown: visible, revealing };
}
