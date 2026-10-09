/**
 * Reading the record back.
 *
 * The verbatim window and the episodes are what a bot remembers without trying;
 * `recall` is how it looks something up. Every item ever written is still in the
 * thread, so recall can return the exact words of a message from months ago,
 * the full output of a tool result that was collapsed to a stub, or everything
 * said around a moment an episode mentions by id.
 *
 * Search is lexical scoring (term frequency weighted by rarity, with a mild
 * preference for recent items) rather than embeddings: it runs on-device with no
 * extra model, and the queries a bot makes — a name, a figure, a phrase it
 * remembers — are exactly the kind lexical search answers well.
 */
import { renderForRecord } from './render';
import { visibleEpisodes, type DotItem, type DotItemKind, type DotThread } from '../thread/thread-types';

export interface RecallQuery {
  ids?: string[];
  query?: string;
  /** An item id to read around. */
  around?: string;
  /** Items on each side of `around`. */
  radius?: number;
  kinds?: DotItemKind[];
  limit?: number;
}

const MAX_OUTPUT_CHARS = 16_000;
const STOPWORDS = new Set('a an and are as at be but by for from has have i in is it its me my of on or our so that the their them they this to was we were what when where which who will with you your'.split(' '));

const terms = (text: string): string[] =>
  text.toLowerCase().normalize('NFKD').split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1 && !STOPWORDS.has(term));

export const parseRecallQuery = (args: Record<string, unknown>): RecallQuery => ({
  ids: Array.isArray(args.ids) ? args.ids.map(String) : typeof args.id === 'string' ? [args.id] : undefined,
  query: typeof args.query === 'string' ? args.query : undefined,
  around: typeof args.around === 'string' ? args.around : undefined,
  radius: typeof args.radius === 'number' ? Math.max(1, Math.min(30, Math.floor(args.radius))) : undefined,
  kinds: Array.isArray(args.kinds) ? (args.kinds.map(String) as DotItemKind[]) : undefined,
  limit: typeof args.limit === 'number' ? Math.max(1, Math.min(50, Math.floor(args.limit))) : undefined,
});

const emit = (items: DotItem[], timeZone: string, header: string): string => {
  const out: string[] = [header];
  let used = header.length;
  let omitted = 0;
  for (const item of items) {
    const line = renderForRecord(item, timeZone, 6_000);
    if (used + line.length > MAX_OUTPUT_CHARS) {
      omitted += 1;
      continue;
    }
    out.push(line);
    used += line.length + 1;
  }
  if (omitted) out.push(`[${omitted} more item${omitted === 1 ? '' : 's'} not shown; narrow the request or read them by id.]`);
  return out.join('\n');
};

export const recallFromThread = (thread: DotThread, query: RecallQuery, timeZone: string): string => {
  const byId = new Map(thread.items.map((item) => [item.id, item]));
  const kinds = query.kinds?.length ? new Set(query.kinds) : null;
  const pool = kinds ? thread.items.filter((item) => kinds.has(item.kind)) : thread.items;

  if (query.ids?.length) {
    const found = query.ids.map((id) => byId.get(id.trim())).filter((item): item is DotItem => Boolean(item));
    const missing = query.ids.filter((id) => !byId.has(id.trim()));
    const header = missing.length ? `No item with id ${missing.join(', ')}.` : `Items ${query.ids.join(', ')}:`;
    return found.length ? emit(found, timeZone, header) : header;
  }

  if (query.around) {
    const center = byId.get(query.around.trim());
    if (!center) return `No item with id ${query.around}.`;
    const radius = query.radius ?? 8;
    const index = thread.items.indexOf(center);
    const window = thread.items.slice(Math.max(0, index - radius), index + radius + 1);
    return emit(window, timeZone, `Around ${center.id}:`);
  }

  const text = query.query?.trim();
  if (!text) return 'Give recall "ids", "around" or a "query".';
  const wanted = [...new Set(terms(text))];
  if (wanted.length === 0) return 'The query has no searchable words.';

  // Rarity weights over the pool, so a name outranks a common word.
  const documentFrequency = new Map<string, number>();
  const itemTerms = pool.map((item) => {
    const counts = new Map<string, number>();
    for (const term of terms(item.text)) counts.set(term, (counts.get(term) ?? 0) + 1);
    for (const term of counts.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    return counts;
  });
  const total = Math.max(1, pool.length);
  const phrase = text.toLowerCase();
  const scored = pool.map((item, index) => {
    const counts = itemTerms[index]!;
    let score = 0;
    let matched = 0;
    for (const term of wanted) {
      const count = counts.get(term);
      if (!count) continue;
      matched += 1;
      const idf = Math.log(1 + total / (documentFrequency.get(term) ?? 1));
      score += idf * (1 + Math.log(count));
    }
    if (matched === 0) return { item, score: 0 };
    score *= matched / wanted.length;
    if (item.text.toLowerCase().includes(phrase)) score *= 1.5;
    score *= 1 + 0.15 * (index / total);
    return { item, score };
  }).filter((entry) => entry.score > 0);

  scored.sort((a, b) => b.score - a.score);
  const limit = query.limit ?? 12;
  const hits = scored.slice(0, limit).map((entry) => entry.item).sort((a, b) => a.seq - b.seq);

  const episodeHits = visibleEpisodes(thread)
    .concat(thread.episodes.filter((episode) => episode.absorbedBy))
    .filter((episode) => wanted.some((term) => episode.text.toLowerCase().includes(term)))
    .slice(0, 3)
    .map((episode) => `[episode ${episode.id} · ${episode.fromSeq ? `i${episode.fromSeq}` : ''}–i${episode.toSeq}] ${episode.text.slice(0, 1_200)}`);

  if (hits.length === 0 && episodeHits.length === 0) return `Nothing in the record matches "${text}".`;
  const body = hits.length ? emit(hits, timeZone, `${scored.length} item${scored.length === 1 ? '' : 's'} match "${text}"; showing ${hits.length}, oldest first:`) : `No items match "${text}" directly.`;
  return episodeHits.length ? `${body}\n\nEpisodes mentioning it:\n${episodeHits.join('\n\n')}` : body;
};
