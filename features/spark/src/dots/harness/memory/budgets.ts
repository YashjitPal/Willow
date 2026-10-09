/**
 * How much of a model's context window a bot uses, and for what.
 *
 * ## The shape
 *
 *   system prompt  ─ stable, a few thousand tokens
 *   memory packet  ─ about the user, the notebook, episode summaries (bounded)
 *   verbatim window─ the recent thread, word for word (the sliding window)
 *   now            ─ the current time and what is new (tiny, always last)
 *
 * ## Why the window is a slice of the context, not all of it
 *
 * A bot wakes many times a day, and every wake re-sends its context. Filling a
 * million-token window on every wake is slow, expensive, and measurably worse:
 * models recall and follow instructions less reliably as the prompt grows, and
 * detail in the middle of a long prompt is the first to go. OpenAI's own Codex
 * build runs GPT-6 Astra — the model behind its bots — at a 272k working window
 * although the model accepts 872k. Willow's user chose the other side of that
 * trade: the window runs to three quarters of the context (about 750k tokens on
 * a 1M-token model, at most 800k) before compaction, and compaction keeps the
 * latest fifth (about 200k) word for word. Between compactions the prefix is
 * stable, so providers' prompt caching carries most of the cost; what is
 * compacted is learned from first (`learning.ts`) and summarised into episodes.
 *
 * ## Hysteresis
 *
 * Compaction starts when the window passes `verbatimHigh` and trims it back to
 * `verbatimLow`, not to just under the line. Trimming to the line would compact
 * again on the very next message; the gap means it runs once per stretch of
 * conversation, and the prompt prefix stays stable — and cache-friendly — in
 * between.
 */

export interface DotBudgets {
  /** The model's context window. */
  window: number;
  /** Total input tokens a turn may send. Past this, compaction runs before the turn. */
  hardCap: number;
  /** The verbatim window's high-water mark: compaction starts above it. */
  verbatimHigh: number;
  /** Where compaction trims the verbatim window back to. */
  verbatimLow: number;
  /** Total size of the episode summaries shown. Past it, old episodes roll up into chapters. */
  episodes: number;
  /** Size of the notebook as shown. Past it, the bot is asked to condense. */
  notebook: number;
  /** Tool results further back than this many tokens are collapsed to a stub. */
  maskAfter: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)));

export const budgetsForWindow = (window: number): DotBudgets => {
  // Compaction starts three quarters of the way into the window — about 750k tokens on a 1M-token model — and
  // keeps the latest fifth verbatim, about 200k: the recent conversation never changes under the bot.
  const verbatimHigh = clamp(window * 0.75, 24_000, 800_000);
  return {
    window,
    hardCap: Math.min(Math.round(window * 0.92), 950_000),
    verbatimHigh,
    verbatimLow: clamp(window * 0.2, 12_000, 200_000),
    episodes: clamp(window * 0.04, 4_000, 32_000),
    notebook: clamp(window * 0.015, 3_000, 12_000),
    maskAfter: clamp(window * 0.05, 8_000, 40_000),
  };
};

/**
 * Context windows by model id. Willow's model catalog carries no window sizes,
 * so this is the bot harness's own table; an unknown model gets a conservative
 * 128k, which errs toward compacting early rather than overflowing.
 */
export const contextWindowFor = (provider: string, model: string): number => {
  const id = model.toLowerCase();
  if (provider === 'gemini' || id.startsWith('gemini')) return 1_048_576;
  if (id.startsWith('gpt-4.1')) return 1_047_576;
  if (id.startsWith('gpt-5') || id.startsWith('gpt-6')) return 400_000;
  if (/^o\d/.test(id)) return 200_000;
  if (id.startsWith('gpt-4o')) return 128_000;
  if (provider === 'anthropic' || id.startsWith('claude')) return 200_000;
  if (id.startsWith('grok-4')) return 256_000;
  if (id.startsWith('grok')) return 131_072;
  if (provider === 'moonshot' || id.startsWith('kimi')) return /k2/.test(id) ? 256_000 : 128_000;
  if (provider === 'zhipuai' || id.startsWith('glm')) return /4\.[5-9]|5/.test(id) ? 200_000 : 128_000;
  return 128_000;
};

export const budgetsFor = (provider: string, model: string): DotBudgets =>
  budgetsForWindow(contextWindowFor(provider, model));
