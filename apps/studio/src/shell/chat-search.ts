export type SearchResult = {
  chatId: string;
  updatedAt: number;
};

export const normalize = (value: unknown): string => String(value ?? '').toLocaleLowerCase();

const flattenMessages = (messages: unknown): string => {
  if (!Array.isArray(messages)) return '';
  return messages.map((message: any) => {
    if (typeof message === 'string') return message;
    return [message?.content, message?.thinkingText]
      .filter((part): part is string => typeof part === 'string')
      .join(' ');
  }).join(' ');
};

export const hashText = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${value.length}:${(hash >>> 0).toString(16)}`;
};

const cosineSimilarity = (left: number[], right: number[]): number => {
  if (left.length === 0 || left.length !== right.length) return Number.NEGATIVE_INFINITY;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return Number.NEGATIVE_INFINITY;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
};

/** Each scope owns a loader and its cache; pending reads retain that cache. */
export const createChatBodyLoader = (loadMessages: (chatId: string) => Promise<unknown>) => {
  const cache = new Map<string, { updatedAt: number; body: string }>();
  return async (candidate: SearchResult): Promise<string> => {
    const cached = cache.get(candidate.chatId);
    if (cached?.updatedAt === candidate.updatedAt) return cached.body;
    let body = '';
    try {
      body = flattenMessages(await loadMessages(candidate.chatId));
    } catch {
      return body;
    }
    cache.set(candidate.chatId, { updatedAt: candidate.updatedAt, body });
    return body;
  };
};

const CHAT_SEARCH_TIMEOUT_MS = 20_000;
const MIN_SEMANTIC_SCORE = 0.42;

type SearchOptions = {
  query: string;
  chats: SearchResult[];
  loadBody: (candidate: SearchResult) => Promise<string>;
  signal: AbortSignal;
  onResults: (results: SearchResult[]) => void;
  semantic?: {
    embedQuery: (signal: AbortSignal) => Promise<number[]>;
    loadVector: (candidate: SearchResult, body: string) => Promise<number[] | null>;
  };
};

/** Cancellation belongs to the caller; an embedding timeout only ends semantic work. */
export async function runChatSearch({ query, chats, loadBody, signal, onResults, semantic }: SearchOptions): Promise<void> {
  const queryKey = normalize(query).trim();
  const matchesText = (candidate: SearchResult, body: string) =>
    normalize(candidate.chatId).includes(queryKey) || normalize(body).includes(queryKey);
  const publish = (results: SearchResult[]) => {
    if (!signal.aborted) onResults(results);
  };
  const lexicalSearch = async () => {
    const matches: SearchResult[] = [];
    for (const candidate of chats) {
      if (signal.aborted) return;
      const body = await loadBody(candidate);
      if (signal.aborted) return;
      if (matchesText(candidate, body)) {
        matches.push(candidate);
        publish([...matches]);
      }
    }
    publish(matches);
  };
  if (signal.aborted) return;
  if (!semantic) return lexicalSearch();

  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, CHAT_SEARCH_TIMEOUT_MS);
  try {
    const queryVector = await semantic.embedQuery(controller.signal);
    clearTimeout(timeout);
    const ranked: Array<{ candidate: SearchResult; score: number }> = [];
    const lexical: SearchResult[] = [];
    for (const candidate of chats) {
      if (signal.aborted) return;
      const body = await loadBody(candidate);
      if (signal.aborted) return;
      const lexicalMatch = matchesText(candidate, body);
      if (lexicalMatch) lexical.push(candidate);
      const vector = await semantic.loadVector(candidate, body);
      const score = vector ? cosineSimilarity(queryVector, vector) : Number.NEGATIVE_INFINITY;
      if (Number.isFinite(score) && (lexicalMatch || score >= MIN_SEMANTIC_SCORE)) {
        ranked.push({ candidate, score });
      }
    }
    ranked.sort((left, right) => right.score - left.score);
    const seen = new Set<string>();
    const results = [...ranked.map(({ candidate }) => candidate), ...lexical]
      .filter(({ chatId }) => {
        if (seen.has(chatId)) return false;
        seen.add(chatId);
        return true;
      }).slice(0, 30);
    publish(results);
  } catch {
    if (!signal.aborted) await lexicalSearch();
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
  }
}
