/**
 * The pure half of Gemini's chat search panel (its `SearchModalDialog` island), read out of the
 * shipped bundle (tools/ui-research/captures/gemini/sidebar-search/): the date labels, the
 * snippet's length, the highlighted runs, the query the panel keeps between openings, and the
 * result order.
 */

/** Gemini's `dateTime` labels: by calendar day, Today/Yesterday, then 2d–6d, 1w–4w, 1mo–11mo, 1y on. */
export const searchDateLabel = (timestamp: number, now: Date = new Date(), locale = 'en'): string => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5;
  const diff = day(date) - day(now);
  if (diff > 0) return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);
  if (diff === 0 || diff === -1) {
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(diff, 'day');
    return relative.charAt(0).toLocaleUpperCase(locale) + relative.slice(1);
  }
  const unit = (name: 'day' | 'week' | 'month' | 'year', value: number) =>
    new Intl.NumberFormat(locale, { style: 'unit', unit: name, unitDisplay: 'narrow' }).format(value);
  const days = Math.abs(diff);
  if (days < 7) return unit('day', days);
  if (days < 30) return unit('week', Math.floor(days / 7));
  const months = Math.floor(days / 30);
  if (months < 12) return locale.toLowerCase().startsWith('en') ? `${months}mo` : unit('month', months);
  return unit('year', Math.max(1, Math.floor(days / 365)));
};

export const SNIPPET_MAX_LENGTH = 200;

/** Gemini's snippet cut: the first 200 UTF-16 units, without splitting a surrogate pair. */
export const trimSnippet = (text: string): string => {
  if (text.length <= SNIPPET_MAX_LENGTH) return text;
  const cut = text.slice(0, SNIPPET_MAX_LENGTH);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
};

export interface TextRange {
  start: number;
  end: number;
}

/** Every place a word of the query occurs in `text`, ignoring case. */
export const matchRanges = (text: string, query: string): TextRange[] => {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const lower = text.toLocaleLowerCase();
  // A case fold that changes the length (`İ`) can't map back onto the original text.
  if (lower.length !== text.length) return [];
  const ranges: TextRange[] = [];
  for (const term of terms) {
    for (let at = lower.indexOf(term); at !== -1; at = lower.indexOf(term, at + term.length)) {
      ranges.push({ start: at, end: at + term.length });
    }
  }
  return ranges;
};

export interface TextSegment {
  text: string;
  highlighted: boolean;
}

/** Gemini's runs: ranges clamped, sorted and merged, the text cut into plain and highlighted parts. */
export const highlightSegments = (text: string, ranges: readonly TextRange[]): TextSegment[] => {
  const merged = ranges
    .map(({ start, end }) => ({ start: Math.max(0, Math.min(text.length, start)), end: Math.max(0, Math.min(text.length, end)) }))
    .filter(({ start, end }) => start < end)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .reduce<TextRange[]>((out, range) => {
      const last = out[out.length - 1];
      if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
      else out.push({ ...range });
      return out;
    }, []);
  if (merged.length === 0) return [{ text, highlighted: false }];
  const segments: TextSegment[] = [];
  let at = 0;
  for (const range of merged) {
    if (at < range.start) segments.push({ text: text.slice(at, range.start), highlighted: false });
    segments.push({ text: text.slice(range.start, range.end), highlighted: true });
    at = range.end;
  }
  if (at < text.length) segments.push({ text: text.slice(at), highlighted: false });
  return segments;
};

/** A message's markdown read as one line of plain text, which is what a snippet shows. */
export const plainSnippetText = (markdown: string): string => markdown
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/^\s{0,3}(?:#{1,6}|>|[-*+])\s+/gm, '')
  .replace(/\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|`([^`]+)`|\*(\S[^*]*)\*/g, (_m, a, b, c, d, e) => a ?? b ?? c ?? d ?? e ?? '')
  .replace(/\s+/g, ' ')
  .trim();

export interface SnippetMessage {
  role: string;
  content?: string;
}

export interface ChatSnippet {
  text: string;
  fromUser: boolean;
  ranges: TextRange[];
}

/**
 * The line a result shows under its title: the first message that holds a word of the query, from
 * the sentence the match is in, else the chat's first prompt. A prompt is quoted, as Gemini quotes
 * a `SNIPPET_TYPE_USER_QUERY` snippet.
 */
export const pickSnippet = (messages: readonly SnippetMessage[], query: string): ChatSnippet | null => {
  const texts = messages
    .map((message) => ({ fromUser: message.role === 'user', text: plainSnippetText(message.content || '') }))
    .filter((message) => message.text);
  const chosen = texts.find((message) => matchRanges(message.text, query).length > 0)
    ?? texts.find((message) => message.fromUser)
    ?? texts[0];
  if (!chosen) return null;
  let body = chosen.text;
  const first = matchRanges(body, query)[0];
  if (first && first.start > 80) {
    const before = body.slice(0, first.start);
    const sentence = Math.max(before.lastIndexOf('. '), before.lastIndexOf('? '), before.lastIndexOf('! '));
    const word = before.lastIndexOf(' ', Math.max(0, first.start - 40));
    body = body.slice(sentence >= 0 && first.start - sentence < 160 ? sentence + 2 : Math.max(0, word + 1));
  }
  body = trimSnippet(body);
  const text = chosen.fromUser ? `\u201c${body}\u201d` : body;
  return { text, fromUser: chosen.fromUser, ranges: matchRanges(text, query) };
};

export type SearchSortOrder = 'relevant' | 'recent';

/** Gemini sorts on the client: as ranked for Most relevant, newest first for Most recent. */
export const sortSearchResults = <T extends { updatedAt: number }>(results: readonly T[], order: SearchSortOrder): T[] =>
  order === 'recent' ? [...results].sort((a, b) => b.updatedAt - a.updatedAt) : [...results];

/** Gemini's recents leave pinned chats out (`conversations(pinned: false)`). */
export const recentChatIds = (chatIds: readonly string[], pinned: readonly string[]): string[] => {
  const skip = new Set(pinned);
  return chatIds.filter((chatId) => !skip.has(chatId));
};

/** Gemini's page sizes: recents 13 at a time as the list scrolls, results 20. */
export const RECENTS_PAGE_SIZE = 13;
export const RESULTS_LIMIT = 20;

/** Gemini's debounce before a typed query runs: 200ms, 270ms on phones and tablets. */
export const SEARCH_DEBOUNCE_MS = 200;
export const SEARCH_DEBOUNCE_COMPACT_MS = 270;

/** The query the panel shows when it opens again, for the rest of the tab's session. */
export const SEARCH_QUERY_STORAGE_KEY = 'willow.search.last_query';

const sessionStore = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

export const readSearchQuery = (): string => {
  try {
    return sessionStore()?.getItem(SEARCH_QUERY_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
};

export const writeSearchQuery = (value: string): void => {
  const store = sessionStore();
  if (!store) return;
  try {
    if (value) store.setItem(SEARCH_QUERY_STORAGE_KEY, value);
    else store.removeItem(SEARCH_QUERY_STORAGE_KEY);
  } catch {
    // Storage full or blocked: the panel just opens empty next time.
  }
};
