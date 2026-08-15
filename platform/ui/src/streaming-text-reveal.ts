/**
 * Gemini does not paint every byte as soon as it reaches the browser. Incoming
 * text first joins a pending suffix, then short prefixes of that suffix are
 * promoted into the animated response. Keeping that policy separate from the
 * markdown renderer makes the ordering and catch-up behaviour testable without
 * a browser or React timers.
 */

export const STREAM_REVEAL_MIN_INTERVAL_MS = 50;
export const STREAM_REVEAL_MAX_INTERVAL_MS = 320;

/** Shared timing for Willow's document-order reveal queue. */
export const GEMINI_DEFAULT_FADE_MS = 610;
export const GEMINI_REVEAL_BASE_DELAY_MS = 150;
export const GEMINI_REVEAL_STAGGER_MS = 120;

export interface GeminiBlockRevealTiming {
  durationMs: number;
  innerDelayMs: number;
  completionMs: number;
}

/**
 * Reveal units use one opacity animation. The base delay gives a newly-mounted
 * unit time to enter after the provider's previous promotion, and the stagger
 * keeps multiple units from the same parse in document order.
 */
const revealUnitCount = (source: string): number => {
  const lines = source.split('\n');
  let count = 0;
  let paragraphOpen = false;
  let fence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      if (!fence) count += 1;
      fence = !fence;
      paragraphOpen = false;
      continue;
    }
    if (fence) continue;
    if (!trimmed) {
      paragraphOpen = false;
      continue;
    }
    if (/^#{1,6}\s+/.test(trimmed) || /^([-+*]|\d+[.)])\s+/.test(trimmed)) {
      count += 1;
      paragraphOpen = true;
      continue;
    }
    if (!paragraphOpen) {
      count += 1;
      paragraphOpen = true;
    }
  }

  return Math.max(1, count);
};

export const geminiRevealTimingAt = (index: number): GeminiBlockRevealTiming => {
  const innerDelayMs = GEMINI_REVEAL_BASE_DELAY_MS + Math.max(0, index) * GEMINI_REVEAL_STAGGER_MS;
  return {
    durationMs: GEMINI_DEFAULT_FADE_MS,
    innerDelayMs,
    completionMs: innerDelayMs + GEMINI_DEFAULT_FADE_MS,
  };
};

export const geminiBlockRevealTimings = (source: string): GeminiBlockRevealTiming[] =>
  Array.from({ length: revealUnitCount(source) }, (_, index) => geminiRevealTimingAt(index));

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
