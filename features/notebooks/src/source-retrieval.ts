/**
 * Pick the passages of a notebook's sources that bear on the question being
 * asked, instead of sending every source on every turn.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Grounding used to take the first 12,000 characters of each source and prepend
 * the lot to every message. Two things were wrong with that. A long source was
 * permanently truncated to its opening — ask about chapter nine of a book and the
 * model only ever saw chapter one — and the whole corpus was re-sent on every
 * turn, so cost and latency grew with the notebook rather than with the question.
 *
 * Google describes the same shape for Gemini Notebook: "when your notebook
 * contains many sources, Gemini Notebook retrieves the most relevant information
 * based on your question first, then builds a response with this information." A
 * small notebook can be sent whole; a large one cannot. Both paths exist here for
 * the same reason.
 *
 * ── Two ranking methods, one interface ────────────────────────────────────
 *
 * Lexical (default): BM25-style term scoring. No network, no keys, no cost, works
 * offline. Good when the question shares vocabulary with the source, which is the
 * common case for notes and documentation.
 *
 * Embeddings (opt-in): cosine similarity over Gemini embeddings, chosen in
 * Settings → Models & API. Matches meaning rather than words, so "how do plants
 * make food" finds a passage about photosynthesis that never uses those words.
 * Costs one embedding call per chunk, once, plus one per question.
 *
 * This mirrors what chat search already does — see `apps/studio/src/shell/
 * SearchChats.tsx`, which resolves the same kind of setting, caches vectors and
 * falls back to lexical on any failure. Deliberately the same shape, so there is
 * one mental model for "search in Willow" rather than two.
 */
import { embedGeminiText, embedGeminiTexts } from '@willow/ai/embeddings';

import type { NotebookSource } from './notebook-types';

/** One retrievable passage. `ordinal` is the source's 1-based number in the prompt. */
export interface SourceChunk {
  sourceId: string;
  ordinal: number;
  title: string;
  url?: string;
  text: string;
  /** Character offset in the source, so a chunk can say where it came from. */
  offset: number;
}

/**
 * ~1,100 characters with ~150 of overlap.
 *
 * Small enough that a chunk is about one idea, large enough to carry the context
 * that makes it readable on its own. The overlap exists because a fact that
 * straddles a boundary would otherwise be split across two chunks and score
 * poorly in both.
 */
const CHUNK_CHARS = 1_100;
const CHUNK_OVERLAP = 150;

/**
 * Split on paragraph boundaries where possible.
 *
 * A hard slice every 1,100 characters cuts mid-sentence, and a chunk that starts
 * halfway through a clause reads as noise to the model and scores badly against
 * any query. Paragraphs are accumulated until adding another would overflow; a
 * single paragraph longer than the budget is sliced, since there is nothing else
 * to break on.
 */
export const chunkText = (text: string): Array<{ text: string; offset: number }> => {
  const out: Array<{ text: string; offset: number }> = [];
  const paragraphs = text.split(/\n{2,}/);
  let buffer = '';
  let bufferOffset = 0;
  let cursor = 0;

  const flush = () => {
    const trimmed = buffer.trim();
    if (trimmed) out.push({ text: trimmed, offset: bufferOffset });
    buffer = '';
  };

  for (const paragraph of paragraphs) {
    const start = cursor;
    cursor += paragraph.length + 2;
    if (paragraph.length > CHUNK_CHARS) {
      flush();
      for (let index = 0; index < paragraph.length; index += CHUNK_CHARS - CHUNK_OVERLAP) {
        const slice = paragraph.slice(index, index + CHUNK_CHARS).trim();
        if (slice) out.push({ text: slice, offset: start + index });
      }
      continue;
    }
    if (buffer.length + paragraph.length > CHUNK_CHARS) flush();
    if (!buffer) bufferOffset = start;
    buffer += (buffer ? '\n\n' : '') + paragraph;
  }
  flush();
  return out;
};

/** Every chunk of every source that has text, numbered as the prompt numbers them. */
export const chunkSources = (sources: readonly NotebookSource[]): SourceChunk[] => {
  const chunks: SourceChunk[] = [];
  sources.forEach((source, index) => {
    if (!source.content) return;
    for (const piece of chunkText(source.content)) {
      chunks.push({
        sourceId: source.id,
        ordinal: index + 1,
        title: source.title,
        url: source.url,
        text: piece.text,
        offset: piece.offset,
      });
    }
  });
  return chunks;
};

// ── Lexical ranking ────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'doing',
  'have', 'has', 'had', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'about', 'as', 'by',
  'from', 'into', 'it', 'its', 'i', 'you', 'he', 'she', 'they', 'we', 'me', 'my', 'your',
  'what', 'which', 'who', 'whom', 'how', 'why', 'when', 'where', 'can', 'could', 'should',
  'would', 'will', 'shall', 'may', 'might', 'must', 'not', 'no', 'so', 'up', 'out', 'there',
]);

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));

/** BM25 saturation and length-normalisation constants, at their usual values. */
const BM25_K1 = 1.5;
const BM25_B = 0.75;

/**
 * Score every chunk against the query with BM25.
 *
 * Chosen over raw term counting because of the two corrections it applies, both of
 * which matter here: repeating a term ten times in one chunk does not make that
 * chunk ten times more relevant (saturation), and a long chunk should not win
 * merely by containing more words (length normalisation). Without them the
 * longest chunk tends to win every query.
 */
export const rankLexically = (query: string, chunks: readonly SourceChunk[]): number[] => {
  const queryTerms = tokenize(query);
  if (!queryTerms.length || !chunks.length) return chunks.map(() => 0);

  const chunkTerms = chunks.map((chunk) => tokenize(chunk.text));
  const averageLength = chunkTerms.reduce((sum, terms) => sum + terms.length, 0) / chunkTerms.length;

  const documentFrequency = new Map<string, number>();
  for (const terms of chunkTerms) {
    for (const term of new Set(terms)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  return chunkTerms.map((terms) => {
    if (!terms.length) return 0;
    const counts = new Map<string, number>();
    for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);

    let score = 0;
    for (const term of new Set(queryTerms)) {
      const frequency = counts.get(term);
      if (!frequency) continue;
      const df = documentFrequency.get(term) ?? 0;
      // +1 inside the log keeps the idf positive for a term present in every
      // chunk; the textbook form can go negative and subtract from the score.
      const idf = Math.log(1 + (chunks.length - df + 0.5) / (df + 0.5));
      const denominator = frequency + BM25_K1 * (1 - BM25_B + BM25_B * (terms.length / averageLength));
      score += idf * ((frequency * (BM25_K1 + 1)) / denominator);
    }
    return score;
  });
};

// ── Embedding ranking ──────────────────────────────────────────────────────

export interface EmbeddingModel {
  provider: string;
  modelId: string;
  apiKey: string;
  baseUrl?: string;
}

const isEmbeddingModel = (model: any): boolean => (
  model?.capabilities?.includes('embedding')
  || model?.category === 'embedding'
  || /embed/i.test((model?.modelId || model?.id) || '')
);

/**
 * The embedding model to rank notebook passages with, or `null` for lexical.
 *
 * Reads `systemDefaults.notebookSearch`, the sibling of the `chatSearch` setting
 * chat search already uses, and follows the same rules deliberately:
 *
 *  - unset, `'linear'` or `'lexical'` means lexical ranking — no calls, no cost;
 *  - the chosen model must still be saved AND be an embedding model, so removing
 *    it from the model list degrades to lexical instead of failing;
 *  - Gemini only, because `embedContent` is the one embedding transport
 *    implemented in `platform/ai`. A model saved under another provider returns
 *    null rather than a request that cannot be made.
 */
export const resolveNotebookEmbeddingModel = (
  modelConfig: any,
  apiKeys: any,
): EmbeddingModel | null => {
  const selectedModelId = modelConfig?.systemDefaults?.notebookSearch;
  if (!selectedModelId || selectedModelId === 'linear' || selectedModelId === 'lexical') return null;

  for (const provider of ['gemini', 'openai', 'anthropic'] as const) {
    const model = modelConfig?.[provider]?.savedModels?.find(
      (candidate: any) => candidate.modelId === selectedModelId && isEmbeddingModel(candidate),
    );
    const apiKey = apiKeys?.[provider]?.find(
      (candidate: unknown) => typeof candidate === 'string' && candidate.trim(),
    );
    if (model && apiKey && provider === 'gemini') {
      return { provider, modelId: model.modelId, apiKey, baseUrl: modelConfig?.[provider]?.baseUrl };
    }
  }
  return null;
};

const cosine = (left: readonly number[], right: readonly number[]): number => {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  if (!leftMagnitude || !rightMagnitude) return 0;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
};

/**
 * Chunk vectors, keyed by model and chunk text.
 *
 * In memory and per session, NOT in IndexedDB. Chat search persists its vectors
 * because a chat body is large and stable; notebook chunks are small, bounded by
 * what localStorage can hold, and re-embedding a whole notebook is one batched
 * call. Persisting would need a new object store and a migration for a saving
 * measured in one request per session — worth doing later, not first.
 *
 * Keyed on the TEXT, not the source id, so editing a source re-embeds only the
 * chunks that actually changed.
 */
const vectorCache = new Map<string, number[]>();
const cacheKey = (modelId: string, text: string) => `${modelId}\u0000${text}`;

/** Embed any chunks not already cached, in batches. Returns vectors in order. */
const embedChunks = async (
  model: EmbeddingModel,
  chunks: readonly SourceChunk[],
  signal?: AbortSignal,
): Promise<Array<number[] | null>> => {
  const missing = chunks.filter((chunk) => !vectorCache.has(cacheKey(model.modelId, chunk.text)));
  const BATCH = 32;
  for (let index = 0; index < missing.length; index += BATCH) {
    const batch = missing.slice(index, index + BATCH);
    const vectors = await embedGeminiTexts({
      apiKey: model.apiKey,
      baseUrl: model.baseUrl,
      modelId: model.modelId,
      items: batch.map((chunk) => ({
        text: chunk.text,
        title: chunk.title,
        taskType: 'RETRIEVAL_DOCUMENT' as const,
      })),
      signal,
    });
    vectors.forEach((vector, offset) => {
      vectorCache.set(cacheKey(model.modelId, batch[offset].text), vector);
    });
  }
  return chunks.map((chunk) => vectorCache.get(cacheKey(model.modelId, chunk.text)) ?? null);
};

// ── Selection ──────────────────────────────────────────────────────────────

/**
 * Total characters of retrieved passage text allowed in one turn.
 *
 * ~24k characters is roughly 6k tokens: enough for a dozen substantial passages,
 * and a fraction of the old behaviour's worst case (ten sources at 12k each).
 */
export const RETRIEVAL_BUDGET_CHARS = 24_000;

export interface SelectionResult {
  chunks: SourceChunk[];
  /** Which ranking actually ran, so the caller can say so. */
  method: 'all' | 'lexical' | 'embedding';
}

/**
 * The passages to ground this turn on.
 *
 * When everything fits inside the budget there is no ranking at all — the whole
 * corpus goes, which is both cheaper and better than retrieving from it, and is
 * what Google's "when your notebook contains many sources" conditional implies
 * for a small notebook.
 *
 * An embedding failure falls back to lexical rather than surfacing an error: a
 * rate-limited key or an expired one must not turn a grounded chat into an
 * ungrounded one, and lexical needs nothing.
 */
export const selectChunks = async ({
  query,
  sources,
  model,
  budget = RETRIEVAL_BUDGET_CHARS,
  signal,
}: {
  query: string;
  sources: readonly NotebookSource[];
  model?: EmbeddingModel | null;
  budget?: number;
  signal?: AbortSignal;
}): Promise<SelectionResult> => {
  const chunks = chunkSources(sources);
  if (!chunks.length) return { chunks: [], method: 'all' };

  const total = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  if (total <= budget) return { chunks, method: 'all' };

  let scores: number[] | null = null;
  let method: SelectionResult['method'] = 'lexical';

  if (model && query.trim()) {
    try {
      const [queryVector, chunkVectors] = await Promise.all([
        embedGeminiText({
          apiKey: model.apiKey,
          baseUrl: model.baseUrl,
          modelId: model.modelId,
          text: query.trim(),
          taskType: 'RETRIEVAL_QUERY',
          signal,
        }),
        embedChunks(model, chunks, signal),
      ]);
      scores = chunkVectors.map((vector) => (vector ? cosine(queryVector, vector) : -Infinity));
      method = 'embedding';
    } catch {
      scores = null;
      method = 'lexical';
    }
  }

  if (!scores) scores = rankLexically(query, chunks);

  const ordered = chunks
    .map((chunk, index) => ({ chunk, score: scores![index] }))
    .sort((left, right) => right.score - left.score);

  const picked: SourceChunk[] = [];
  let used = 0;
  for (const { chunk } of ordered) {
    if (used + chunk.text.length > budget) continue;
    picked.push(chunk);
    used += chunk.text.length;
  }

  /*
   * Restored to document order before returning. Ranking order puts the best
   * match first, which reads as a jumble when several chunks come from one
   * document — a model handed passages in their original sequence can follow an
   * argument across them.
   */
  picked.sort((left, right) => (left.ordinal - right.ordinal) || (left.offset - right.offset));
  return { chunks: picked, method };
};
