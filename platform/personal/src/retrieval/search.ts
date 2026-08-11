/**
 * Ranking chats against a query, and turning the winners into text.
 *
 * BM25-ish: term overlap weighted by how rare each term is across the corpus,
 * with a recency nudge. Rarity is what makes this work on one person's chat
 * history — "photosynthesis" appears in two conversations and "help" appears in
 * two hundred, so matching the first is worth far more than matching the second,
 * and a plain overlap count gets that exactly backwards.
 */

import type { ChatIndex, IndexedChat } from './index-chats';
import { tokenize } from './index-chats';

export interface SearchHit {
  chat: IndexedChat;
  score: number;
  /** Query terms this chat actually matched, for the quoting step. */
  matched: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Saturation point: a fifth mention of a term adds almost nothing over a
 *  fourth, so a chat that repeats one word cannot outrank one that covers the
 *  whole query. */
const K1 = 1.2;

/**
 * Score one chat against a set of query terms.
 *
 * The recency multiplier is deliberately gentle. A year-old conversation that
 * matches the query exactly should still beat a recent one that barely matches —
 * "what did I decide about this" is frequently a question about something old,
 * and a strong recency weight makes the tool unable to answer it.
 */
const scoreChat = (
  chat: IndexedChat,
  queryTerms: string[],
  index: ChatIndex,
  now: number,
): SearchHit | null => {
  const total = Math.max(index.chats.length, 1);
  let score = 0;
  const matched: string[] = [];

  for (const term of queryTerms) {
    const frequency = chat.terms.get(term);
    if (!frequency) continue;
    const documentFrequency = index.documentFrequency.get(term) ?? 1;
    const idf = Math.log(1 + (total - documentFrequency + 0.5) / (documentFrequency + 0.5));
    score += idf * ((frequency * (K1 + 1)) / (frequency + K1));
    matched.push(term);
  }

  if (matched.length === 0) return null;

  // Covering more of the query is worth more than hammering one term of it.
  score *= 1 + (matched.length / queryTerms.length) * 0.5;

  const ageDays = Math.max(0, (now - chat.updatedAt) / DAY_MS);
  score *= 1 + Math.exp(-ageDays / 180) * 0.25;

  return { chat, score, matched };
};

export const searchIndex = (
  index: ChatIndex,
  query: string,
  { limit = 5, now = Date.now() }: { limit?: number; now?: number } = {},
): SearchHit[] => {
  const queryTerms = Array.from(new Set(tokenize(query)));
  if (queryTerms.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const chat of index.chats) {
    const hit = scoreChat(chat, queryTerms, index, now);
    if (hit) hits.push(hit);
  }

  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, limit);
  if (top.length === 0) return [];

  // Drop the long tail of chats that matched one common word. Without this the
  // tool returns five results for every query, three of which are noise, and the
  // model treats all five as equally relevant because it cannot see the scores.
  const best = top[0].score;
  return top.filter((hit) => hit.score >= best * 0.35);
};

/** Per result, so five hits stay inside a reasonable tool response. */
const RESULT_CHARS = 900;

/**
 * The turns from a hit that are actually about the query.
 *
 * A matching user turn is included with the reply that followed it, because the
 * answer is frequently where the fact lives — the user asks "which one should I
 * get" and the useful part is that they then said "ok, ordering the second one".
 */
const quoteHit = (hit: SearchHit): string => {
  const wanted = new Set(hit.matched);
  const lines: string[] = [];
  let used = 0;

  hit.chat.snippets.forEach((snippet, position) => {
    if (used >= RESULT_CHARS) return;
    if (snippet.role !== 'user') return;
    const terms = new Set(tokenize(snippet.text));
    if (![...wanted].some((term) => terms.has(term))) return;

    const line = `You: ${snippet.text}`;
    lines.push(line);
    used += line.length;

    const reply = hit.chat.snippets[position + 1];
    if (reply?.role === 'assistant' && used < RESULT_CHARS) {
      const replyLine = `Willow: ${reply.text}`;
      lines.push(replyLine);
      used += replyLine.length;
    }
  });

  // A chat can rank on its title alone, with no single turn containing the term.
  // Falling back to the opening exchange is better than returning a bare title.
  if (lines.length === 0) {
    for (const snippet of hit.chat.snippets.slice(0, 2)) {
      lines.push(`${snippet.role === 'user' ? 'You' : 'Willow'}: ${snippet.text}`);
    }
  }

  const date = new Date(hit.chat.updatedAt || Date.now()).toISOString().slice(0, 10);
  return `From "${hit.chat.chatId}" (${date}):\n${lines.join('\n')}`;
};

/**
 * Search results as the strings the tool hands back to the model.
 *
 * Each result names its conversation and its date. That is not decoration: the
 * model needs the date to prefer a recent statement over a contradicting older
 * one, and Step 2 of the personalization rules tells it to do exactly that.
 */
export const searchResultTexts = (
  index: ChatIndex,
  query: string,
  options?: { limit?: number; now?: number },
): string[] => searchIndex(index, query, options).map(quoteHit);
