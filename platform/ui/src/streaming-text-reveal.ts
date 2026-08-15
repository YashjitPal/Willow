/**
 * Gemini does not paint every byte as soon as it reaches the browser. Incoming
 * text first joins a pending suffix, then short prefixes of that suffix are
 * promoted into the animated response. Keeping that policy separate from the
 * markdown renderer makes the ordering and catch-up behaviour testable without
 * a browser or React timers.
 */

export const STREAM_REVEAL_MIN_INTERVAL_MS = 50;
export const STREAM_REVEAL_MAX_INTERVAL_MS = 320;

/**
 * Gemini's scheduler adds 600ms to its rolling provider cadence before dividing
 * by the number of pending block/text nodes. The two live one-line captures
 * added 9ms and 13ms respectively, producing 609ms and 613ms fades. Ten is the
 * stable centre of those captures for a locally-buffered response.
 */
export const GEMINI_REVEAL_WINDOW_MS = 610;
export const GEMINI_DEFAULT_FADE_MS = 400;
export const GEMINI_MIN_FADE_MS = 200;
export const GEMINI_MAX_FADE_MS = 900;

export interface GeminiBlockRevealTiming {
  durationMs: number;
  innerDelayMs: number;
  completionMs: number;
}

/**
 * Gemini marks each block plus its text layer as pending. It promotes them in
 * DOM order. The wait before the next item is roughly
 * `(rolling provider cadence + 600) / (pending count + 1)`, and slow items get
 * a custom fade of `clamp(wait * 3, 200, 900)` instead of the default 400ms.
 */
export const geminiBlockRevealTimings = (
  source: string,
): GeminiBlockRevealTiming[] => {
  const paragraphs = source
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length === 0 && source.trim()) paragraphs.push(source.trim());

  // The live one-line capture had two pending DOM nodes: the paragraph and its
  // inner text span. Punctuation inside that paragraph did not add another
  // block-level queue item, which is why a two-sentence error uses the same
  // 610ms + 305ms layered reveal as a one-sentence reply.
  const unitCounts = paragraphs.map(() => 2);
  const totalUnits = unitCounts.reduce((total, count) => total + count, 0);
  let consumedUnits = 0;

  return unitCounts.map((unitCount) => {
    const remainingBeforeBlock = Math.max(1, totalUnits - consumedUnits);
    const blockCadence = GEMINI_REVEAL_WINDOW_MS / (remainingBeforeBlock + 1);
    const durationMs = blockCadence > GEMINI_DEFAULT_FADE_MS / 3
      ? Math.floor(Math.max(
          GEMINI_MIN_FADE_MS,
          Math.min(blockCadence * 3, GEMINI_MAX_FADE_MS),
        ))
      : GEMINI_DEFAULT_FADE_MS;
    // Once the outer block is promoted, Gemini recomputes the queue with one
    // fewer pending node. That next cadence is the block -> text stagger.
    const innerDelayMs = Math.round(GEMINI_REVEAL_WINDOW_MS / remainingBeforeBlock);
    consumedUnits += unitCount;
    return {
      durationMs,
      innerDelayMs,
      completionMs: durationMs + innerDelayMs,
    };
  });
};

export const geminiRevealTailMs = (source: string): number => {
  const timings = geminiBlockRevealTimings(source);
  return timings.length
    ? Math.max(...timings.map((timing) => timing.completionMs))
    : GEMINI_DEFAULT_FADE_MS;
};

const includeTrailingWhitespace = (source: string, end: number): number => {
  let cursor = end;
  while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
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

/**
 * The next visible prefix length.
 *
 * Gemini promotes a complete sentence or paragraph when one is buffered. A
 * partial live sentence still advances at word boundaries so a slow provider
 * cannot leave the response blank while it waits for punctuation.
 */
export const nextStreamingRevealLength = (
  source: string,
  visibleLength: number,
): number => {
  const from = Math.max(0, Math.min(visibleLength, source.length));
  if (from >= source.length) return source.length;

  const suffix = source.slice(from);
  const semanticBoundary = semanticBoundaryFor(suffix);
  if (Number.isFinite(semanticBoundary)) {
    return Math.min(source.length, from + includeTrailingWhitespace(suffix, semanticBoundary));
  }

  const budget = wordBudgetFor(suffix.length);
  const words = /\S+\s*/g;
  let match: RegExpExecArray | null = null;
  let end = 0;

  for (let count = 0; count < budget; count += 1) {
    match = words.exec(suffix);
    if (!match) break;
    end = match.index + match[0].length;
  }

  // A partial token with no whitespace must not wait forever for its boundary.
  return end > 0 ? Math.min(source.length, from + end) : source.length;
};

/**
 * Delay before the next promotion.
 *
 * The live Gemini capture ranged from roughly 50ms for small runs to 320ms for
 * its longest paragraph runs. The interval grows with the amount of text being
 * introduced instead of ticking at a fixed word-by-word rate.
 */
export const nextStreamingRevealDelayMs = (
  source: string,
  visibleLength: number,
): number => {
  const nextLength = nextStreamingRevealLength(source, visibleLength);
  const introducedLength = Math.max(0, nextLength - visibleLength);
  return Math.max(
    STREAM_REVEAL_MIN_INTERVAL_MS,
    Math.min(
      STREAM_REVEAL_MAX_INTERVAL_MS,
      Math.round(36 + introducedLength * 1.6),
    ),
  );
};

/** First promoted chunk for a newly mounted response. */
export const initialStreamingReveal = (source: string, paced: boolean): string =>
  paced ? source.slice(0, nextStreamingRevealLength(source, 0)) : source;

/**
 * Keep a visible prefix when the source merely grows. A replaced response has
 * no safe shared identity, so it starts its own reveal instead of mixing two
 * answers. A contraction is safe to apply immediately because it only removes
 * text that is no longer present upstream.
 */
export const reconcileStreamingReveal = (
  visible: string,
  source: string,
  paced: boolean,
): string => {
  if (!paced) return source;
  if (source.startsWith(visible)) return visible;
  if (visible.startsWith(source)) return source;
  return '';
};
