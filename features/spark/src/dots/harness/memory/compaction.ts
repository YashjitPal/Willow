/**
 * Background compaction: keeping the verbatim window inside its budget without
 * ever losing the record.
 *
 * When the uncovered tail passes `verbatimHigh`, the oldest stretch of it is
 * summarised into a level-1 episode and the window starts after it; the tail is
 * trimmed to `verbatimLow` so this happens once per stretch of conversation, not
 * on every message. Close to the line, an idle bot compacts early, once the
 * provider's prompt cache has lapsed (`compactionTiming`). Cuts land on exchange boundaries — just before something
 * new arrives from outside — so a call is never separated from its result and a
 * reply never from what it answered.
 *
 * When the episodes themselves outgrow their budget, the oldest are rolled up
 * into a chapter. Recent history therefore stays detailed and old history stays
 * present but compressed, and the whole past fits in a bounded space however
 * long the thread runs.
 *
 * Nothing here deletes an item. Episodes are an index over the record, not a
 * replacement for it, and every episode cites the ids it covers.
 */
import type { DotBudgets } from './budgets';
import { episodeSystemPrompt, episodeUserPrompt, rollupSystemPrompt, rollupUserPrompt } from './compaction-prompts';
import { uncoveredTailTokens, windowItemTokens, windowMaskLine } from './context-builder';
import { notebookProjection } from './notebook';
import { formatStamp, renderForRecord } from './render';
import { estimateTokens } from './tokens';
import { getDotThread, recordDotEpisodes } from '../thread/thread-store';
import { visibleEpisodes, type DotEpisode, type DotItem, type DotThread } from '../thread/thread-types';

export type DotSummarizer = (request: { systemPrompt: string; prompt: string; signal?: AbortSignal }) => Promise<string>;

export interface CompactionOptions {
  dotId: string;
  budgets: DotBudgets;
  timeZone: string;
  dotName: string;
  userName?: string;
  summarize: DotSummarizer;
  signal?: AbortSignal;
  /**
   * Compact even below the high-water mark, down to this many tokens. Used when
   * a request is about to overflow, or the provider has rejected one as too long.
   */
  emergencyTarget?: number;
  /** Compact down to `verbatimLow` although the tail is not past `verbatimHigh` yet (`compactionTiming`'s `early`). */
  early?: boolean;
}

export interface CompactionResult {
  episodes: number;
  chapters: number;
}

/** Items newer than this are never compacted, however large. */
const KEEP_NEWEST_ITEMS = 6;
/** The most transcript one summarisation request may carry. */
const CHUNK_TOKENS = 60_000;
/** A tool result is cut to this inside a compaction transcript; recall still has it whole. */
const RESULT_CHARS_IN_TRANSCRIPT = 3_000;
const MAX_ROLLUPS_PER_PASS = 3;

const nextEpisodeId = (thread: DotThread): string => {
  const highest = thread.episodes.reduce((max, episode) => Math.max(max, Number(episode.id.replace(/\D/g, '')) || 0), 0);
  return `ep${highest + 1}`;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)));

/**
 * The stretch to compact: the oldest uncovered items whose removal brings the
 * tail down to `target`, extended to the next exchange boundary.
 */
export const planCompactionRange = (thread: DotThread, budgets: DotBudgets, timeZone: string, target: number): DotItem[] => {
  const cpt = thread.runtime.charsPerToken;
  const tail = thread.items.filter((item) => item.seq > thread.runtime.lastCompactedSeq && !(item.kind === 'dot' && item.streaming));
  if (tail.length <= KEEP_NEWEST_ITEMS) return [];
  const masking = windowMaskLine(tail, budgets, timeZone, cpt);
  const total = tail.reduce((sum, item) => sum + windowItemTokens(item, masking, timeZone, cpt), 0);
  const excess = total - target;
  if (excess <= 0) return [];

  const lastCompactable = tail.length - KEEP_NEWEST_ITEMS - 1;
  let removed = 0;
  let cut = -1;
  while (cut < lastCompactable && removed < excess) {
    cut += 1;
    removed += windowItemTokens(tail[cut]!, masking, timeZone, cpt);
  }
  // Extend to a boundary: the next item should be something new from outside.
  while (cut < lastCompactable && tail[cut + 1] && tail[cut + 1]!.kind !== 'user' && tail[cut + 1]!.kind !== 'event') cut += 1;
  return cut < 0 ? [] : tail.slice(0, cut + 1);
};

const chunked = (items: DotItem[], timeZone: string, cpt: number | undefined): DotItem[][] => {
  const chunks: DotItem[][] = [];
  let current: DotItem[] = [];
  let used = 0;
  for (const item of items) {
    const tokens = estimateTokens(renderForRecord(item, timeZone, RESULT_CHARS_IN_TRANSCRIPT), cpt);
    const boundary = item.kind === 'user' || item.kind === 'event';
    if (current.length && used + tokens > CHUNK_TOKENS && boundary) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(item);
    used += tokens;
  }
  if (current.length) chunks.push(current);
  return chunks;
};

const summarizeChunk = async (options: CompactionOptions, thread: DotThread, items: DotItem[]): Promise<DotEpisode> => {
  const { budgets, timeZone } = options;
  const cpt = thread.runtime.charsPerToken;
  const maxTokens = clamp(budgets.episodes / 6, 800, 2_500);
  const previous = visibleEpisodes(thread).at(-1)?.text;
  const transcript = items.map((item) => renderForRecord(item, timeZone, RESULT_CHARS_IN_TRANSCRIPT)).join('\n');
  const text = (await options.summarize({
    systemPrompt: episodeSystemPrompt({ dotName: options.dotName, userName: options.userName, timeZone, maxTokens }),
    prompt: episodeUserPrompt({
      transcript,
      fromId: items[0]!.id,
      toId: items.at(-1)!.id,
      notebook: notebookProjection(thread.notebook, budgets.notebook, cpt, timeZone),
      previous,
    }),
    signal: options.signal,
  })).trim();
  if (!text) throw new Error('The summariser returned nothing.');
  return {
    id: nextEpisodeId(thread),
    level: 1,
    fromSeq: items[0]!.seq,
    toSeq: items.at(-1)!.seq,
    fromAt: items[0]!.at,
    toAt: items.at(-1)!.at,
    text,
    tokens: estimateTokens(text, cpt),
    createdAt: Date.now(),
  };
};

const rollUp = async (options: CompactionOptions): Promise<number> => {
  let chapters = 0;
  for (let pass = 0; pass < MAX_ROLLUPS_PER_PASS; pass += 1) {
    const thread = getDotThread(options.dotId);
    if (!thread) return chapters;
    const visible = visibleEpisodes(thread);
    const total = visible.reduce((sum, episode) => sum + episode.tokens, 0);
    if (total <= options.budgets.episodes || visible.length < 3) return chapters;

    // The oldest run worth about half the budget, keeping the newest summary apart.
    const run: DotEpisode[] = [];
    let used = 0;
    for (const episode of visible.slice(0, -1)) {
      run.push(episode);
      used += episode.tokens;
      if (run.length >= 2 && used >= options.budgets.episodes * 0.5) break;
    }
    if (run.length < 2) return chapters;

    const maxTokens = clamp(options.budgets.episodes / 3, 1_200, 4_000);
    const text = (await options.summarize({
      systemPrompt: rollupSystemPrompt({ dotName: options.dotName, userName: options.userName, timeZone: options.timeZone, maxTokens }),
      prompt: rollupUserPrompt(run.map((episode) => ({
        id: episode.id,
        span: `i${episode.fromSeq}–i${episode.toSeq}, ${formatStamp(episode.fromAt, options.timeZone)} → ${formatStamp(episode.toAt, options.timeZone)}`,
        text: episode.text,
      }))),
      signal: options.signal,
    })).trim();
    if (!text) throw new Error('The summariser returned nothing for a chapter.');
    const chapter: DotEpisode = {
      id: nextEpisodeId(thread),
      level: Math.max(...run.map((episode) => episode.level)) + 1,
      fromSeq: run[0]!.fromSeq,
      toSeq: run.at(-1)!.toSeq,
      fromAt: run[0]!.fromAt,
      toAt: run.at(-1)!.toAt,
      text,
      tokens: estimateTokens(text, thread.runtime.charsPerToken),
      childIds: run.map((episode) => episode.id),
      createdAt: Date.now(),
    };
    recordDotEpisodes(options.dotId, { add: [chapter], absorb: { ids: chapter.childIds!, by: chapter.id } });
    chapters += 1;
  }
  return chapters;
};

/** Whether the tail has outgrown its budget. */
export const needsCompaction = (thread: DotThread, budgets: DotBudgets, timeZone: string): boolean =>
  uncoveredTailTokens(thread, budgets, timeZone) > budgets.verbatimHigh;

/**
 * How long a provider keeps a prompt prefix cached after its last use, give or take: five minutes is the common
 * default (Anthropic's, and the low end of OpenAI's and Gemini's).
 */
export const PROMPT_CACHE_MS = 5 * 60_000;
/** How far from `verbatimLow` towards `verbatimHigh` the tail must be before an idle bot compacts early. */
const EARLY_FRACTION = 0.85;

/**
 * When to compact, not only whether.
 *
 * Past `verbatimHigh` it is due `now`, after the turn that crossed the line. In the last stretch before it, it is
 * worth doing early, but only once the bot has been idle past the provider's cache: moving the window shifts the
 * prompt, which costs a cached prefix while a conversation is going and nothing once the cache has lapsed — and
 * the next conversation then starts with room, instead of compacting partway through.
 */
export const compactionTiming = (thread: DotThread, budgets: DotBudgets, timeZone: string, idleMs: number): 'now' | 'early' | 'none' => {
  const tail = uncoveredTailTokens(thread, budgets, timeZone);
  if (tail > budgets.verbatimHigh) return 'now';
  const early = budgets.verbatimLow + (budgets.verbatimHigh - budgets.verbatimLow) * EARLY_FRACTION;
  return tail > early && idleMs > PROMPT_CACHE_MS ? 'early' : 'none';
};

export const compactDotThread = async (options: CompactionOptions): Promise<CompactionResult> => {
  const thread = getDotThread(options.dotId);
  if (!thread) return { episodes: 0, chapters: 0 };
  const due = options.emergencyTarget !== undefined || options.early || needsCompaction(thread, options.budgets, options.timeZone);
  let episodes = 0;
  if (due) {
    const target = options.emergencyTarget ?? options.budgets.verbatimLow;
    const range = planCompactionRange(thread, options.budgets, options.timeZone, target);
    for (const chunk of chunked(range, options.timeZone, thread.runtime.charsPerToken)) {
      if (options.signal?.aborted) break;
      const current = getDotThread(options.dotId);
      if (!current) break;
      const episode = await summarizeChunk(options, current, chunk);
      recordDotEpisodes(options.dotId, { add: [episode], lastCompactedSeq: episode.toSeq });
      episodes += 1;
    }
  }
  const chapters = options.signal?.aborted ? 0 : await rollUp(options);
  return { episodes, chapters };
};
