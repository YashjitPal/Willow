/**
 * A keyword index over the user's chats, built in memory when first needed.
 *
 * The retrieval tool has to answer "what did I say about X" against a few hundred
 * local chat files. Reading every file on every call would take seconds; keeping
 * a persistent index on disk would be a second copy of the user's conversations
 * to maintain and invalidate. So the index is built once per session, lazily, the
 * first time the tool is actually called — most sessions never call it and pay
 * nothing.
 *
 * No embeddings and no vector store. At this scale term overlap plus a recency
 * bias finds the right conversation, and the alternative means shipping a model
 * to run locally or sending every conversation to a remote embedding endpoint.
 * The scale where that trade flips is not a few hundred chat files.
 */

import type { RawSavedMessage } from '../builder/transcript';

export interface IndexedChat {
  chatId: string;
  updatedAt: number;
  /** Term frequencies for the user's own words. */
  terms: Map<string, number>;
  /** Trimmed turns, kept so a hit can be quoted without re-reading the file. */
  snippets: { role: 'user' | 'assistant'; text: string }[];
}

export interface ChatIndex {
  chats: IndexedChat[];
  /** Document frequency per term, for the IDF weighting in `search.ts`. */
  documentFrequency: Map<string, number>;
  builtAt: number;
}

/**
 * Words carrying no discriminating power in a corpus of one person's questions.
 *
 * Short by design. An aggressive stop list would strip terms that are genuinely
 * distinguishing in this corpus — "how" and "why" separate a tutorial request
 * from a factual one, and both are on every general-purpose stop list.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'do', 'does', 'for',
  'from', 'had', 'has', 'have', 'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my',
  'of', 'on', 'or', 'so', 'than', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'to', 'was', 'were', 'will', 'with', 'you',
  'your', 'am', 'been', 'can', 'could', 'would', 'should', 'about', 'into',
  'just', 'like', 'not', 'now', 'only', 'other', 'out', 'over', 'some', 'such',
  'up', 'we', 'what', 'when', 'which', 'who', 'get', 'got', 'make', 'want',
]);

/** Two characters is an operator or a typo; anything longer is a word. */
const MIN_TERM_LENGTH = 3;

/**
 * Split text into indexable terms.
 *
 * Unicode-aware rather than `[a-z]`: the user writes in more than one script and
 * an ASCII-only tokenizer would index their English and silently drop everything
 * else, which reads as "search does not work for some questions".
 */
export const tokenize = (text: string): string[] => {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter((word) => word.length >= MIN_TERM_LENGTH && !STOP_WORDS.has(word));
  return words;
};

/** How much of a turn to keep for quoting back. */
const SNIPPET_CHARS = 400;
/** Turns kept per chat. Enough to quote a hit in context, not the whole thread. */
const MAX_SNIPPETS = 24;

const clip = (text: string): string =>
  text.length <= SNIPPET_CHARS ? text : `${text.slice(0, SNIPPET_CHARS).trimEnd()}…`;

/**
 * Index one chat, or `null` if there is nothing searchable in it.
 *
 * Only the user's turns feed the term index, while both roles are kept as
 * snippets. Indexing assistant text would make every chat match every query —
 * the assistant restates the question, defines the terms, and offers three
 * related topics, so its turns are a superset of the user's vocabulary and drown
 * out the actual signal.
 */
export const indexChat = (
  chatId: string,
  messages: RawSavedMessage[],
  updatedAt: number,
): IndexedChat | null => {
  const terms = new Map<string, number>();
  const snippets: IndexedChat['snippets'] = [];

  for (const message of messages) {
    const role = message?.role === 'user' ? 'user' : message?.role === 'assistant' ? 'assistant' : null;
    if (!role) continue;
    const text = typeof message?.content === 'string' ? message.content.trim() : '';
    if (!text) continue;

    if (role === 'user') {
      for (const term of tokenize(text)) {
        terms.set(term, (terms.get(term) ?? 0) + 1);
      }
    }
    if (snippets.length < MAX_SNIPPETS) snippets.push({ role, text: clip(text) });
  }

  // The chat id is usually the model-generated title, which is often the best
  // one-line summary of the conversation, so it is indexed with extra weight.
  for (const term of tokenize(chatId.replace(/[-_]/g, ' '))) {
    terms.set(term, (terms.get(term) ?? 0) + 3);
  }

  if (terms.size === 0) return null;
  return { chatId, updatedAt, terms, snippets };
};

export const buildIndex = (chats: IndexedChat[], builtAt: number): ChatIndex => {
  const documentFrequency = new Map<string, number>();
  for (const chat of chats) {
    for (const term of chat.terms.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  return { chats, documentFrequency, builtAt };
};

export const EMPTY_INDEX: ChatIndex = {
  chats: [],
  documentFrequency: new Map(),
  builtAt: 0,
};
