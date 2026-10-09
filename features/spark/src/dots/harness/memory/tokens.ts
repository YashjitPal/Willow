/**
 * Token estimates without a tokenizer.
 *
 * Willow ships no tokenizer and providers disagree on what a token is, so a bot
 * estimates from characters and then *calibrates*: every response reports how
 * many input tokens the provider actually counted, and the ratio of characters
 * sent to tokens charged is folded into a per-dot running average. After a few
 * turns the estimate tracks that bot's own model closely, which is what the
 * compaction thresholds need — a budget that is 20% wrong compacts 20% too
 * early or too late.
 */

/** Characters per token before a bot has any measurements: a fair average for English prose and JSON. */
export const DEFAULT_CHARS_PER_TOKEN = 3.8;

const MIN_RATIO = 1.5;
const MAX_RATIO = 6;
/** How much one measurement moves the running average. */
const SMOOTHING = 0.3;

/**
 * Estimated tokens for `text`. Characters outside Latin script (CJK above all)
 * cost roughly a token each, so they are counted apart rather than diluting the
 * average for everything else.
 */
export const estimateTokens = (text: string, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number => {
  if (!text) return 0;
  let heavy = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0x2e80 && code <= 0xffef) heavy += 1;
  }
  return Math.ceil((text.length - heavy) / charsPerToken + heavy);
};

/**
 * Folds one provider measurement into the running ratio. Ignored when either
 * side is too small to say anything (a tiny request is mostly fixed overhead).
 */
export const calibrateCharsPerToken = (current: number | undefined, promptChars: number, inputTokens: number | undefined): number | undefined => {
  if (!inputTokens || inputTokens < 2_000 || promptChars < 8_000) return current;
  const measured = Math.min(MAX_RATIO, Math.max(MIN_RATIO, promptChars / inputTokens));
  if (current === undefined) return measured;
  return current * (1 - SMOOTHING) + measured * SMOOTHING;
};
