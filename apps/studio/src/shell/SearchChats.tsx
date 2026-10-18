import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { embedGeminiText, embedGeminiTexts } from '@willow/ai/embeddings';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import { loadChatEmbedding, saveChatEmbedding } from '@willow/storage/indexeddb/willow-db';
import { chatDisplayName } from '@willow/storage/local-fs/chat-metadata';
import { checkCodeChat } from '@willow/storage/code-chat-storage';
import { requestCodeChatOpen } from '@willow/storage/code-chat-open-store';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { pickSnippet, RESULTS_LIMIT, SEARCH_DEBOUNCE_MS, type ChatSnippet, type SnippetMessage } from './search/search-format';

type SearchResult = {
  chatId: string;
  updatedAt: number;
};

/** A chat the search found, with the line its row shows under the title. */
export type ChatSearchResult = SearchResult & {
  snippet: ChatSnippet | null;
};

const normalize = (value: unknown): string => String(value ?? '').toLocaleLowerCase();

const messagesOf = (messages: unknown): SnippetMessage[] => (Array.isArray(messages)
  ? messages.flatMap((message: any) => (message && typeof message === 'object' && typeof message.content === 'string'
    ? [{ role: String(message.role ?? ''), content: message.content }]
    : []))
  : []);

const flattenMessages = (messages: unknown): string => {
  if (!Array.isArray(messages)) return '';
  return messages.map((message: any) => {
    if (typeof message === 'string') return message;
    return [message?.content, message?.thinkingText]
      .filter((part): part is string => typeof part === 'string')
      .join(' ');
  }).join(' ');
};

const MAX_EMBEDDING_DOCUMENT_CHARS = 24_000;
const CHAT_EMBEDDING_BATCH_SIZE = 20;
const CHAT_EMBEDDING_INDEX_TIMEOUT_MS = 60_000;
const CHAT_SEARCH_TIMEOUT_MS = 20_000;
const MIN_SEMANTIC_SCORE = 0.42;

const hashText = (value: string): string => {
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

const isEmbeddingModel = (model: any): boolean => (
  model?.capabilities?.includes('embedding') ||
  model?.category === 'embedding' ||
  /embed/i.test((model?.modelId || model?.id) || '')
);

const resolveSearchEmbeddingModel = (modelConfig: any, apiKeys: any) => {
  const selectedModelId = modelConfig?.systemDefaults?.chatSearch;
  if (!selectedModelId || selectedModelId === 'linear' || selectedModelId === 'lexical') return null;

  const providers = ['gemini', 'openai', 'anthropic', 'moonshot', 'spacexai', 'zhipuai'];
  for (const provider of providers) {
    const model = modelConfig?.[provider]?.savedModels?.find(
      (candidate: any) => candidate.modelId === selectedModelId && isEmbeddingModel(candidate),
    );
    const apiKey = apiKeys?.[provider]?.find((candidate: unknown) => typeof candidate === 'string' && candidate.trim());
    // Gemini's embedContent contract is the only embedding transport currently implemented.
    if (model && apiKey && provider === 'gemini') {
      return {
        provider,
        modelId: model.modelId,
        apiKey,
        baseUrl: modelConfig?.[provider]?.baseUrl,
      };
    }
  }
  return null;
};

type SearchEmbeddingModel = NonNullable<ReturnType<typeof resolveSearchEmbeddingModel>>;

type PendingEmbedding = {
  candidate: SearchResult;
  contentHash: string;
  documentText: string;
};

const completedEmbeddingIndexes = new Set<string>();
const embeddingIndexPromises = new Map<string, Promise<void>>();

const getEmbeddingIndexKey = (
  scopeId: string,
  model: SearchEmbeddingModel,
  chats: SearchResult[],
): string => {
  const revision = chats.map((chat) => `${chat.chatId}:${chat.updatedAt}`).join('|');
  return `${scopeId}:${model.provider}:${model.modelId}:${hashText(revision)}`;
};

const ensureChatEmbeddingIndex = async (
  scopeId: string,
  model: SearchEmbeddingModel,
  chats: SearchResult[],
  loadBody: (candidate: SearchResult) => Promise<string>,
): Promise<void> => {
  const indexKey = getEmbeddingIndexKey(scopeId, model, chats);
  if (completedEmbeddingIndexes.has(indexKey)) return;
  const active = embeddingIndexPromises.get(indexKey);
  if (active) return active;

  /*
   * No top-loading reason here, deliberately.
   *
   * `ChatEmbeddingIndexer` is mounted for the whole app and re-runs whenever the
   * chat list or any chat's timestamp changes — so it fires on every save,
   * including the one that creates a brand-new session. Raising the route-progress
   * bar for that made a green bar flash across the top of the app for background
   * re-embedding the user never asked for and cannot act on. The work still runs;
   * it just does not claim to be a route transition.
   *
   * A search the user actually typed still raises `chat-search:<generation>`
   * below, and that reason covers any indexing the query has to wait on.
   */
  const run = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CHAT_EMBEDDING_INDEX_TIMEOUT_MS);
    try {
      const pending: PendingEmbedding[] = [];
      for (const candidate of chats) {
        const body = await loadBody(candidate);
        const documentText = `${candidate.chatId}\n\n${body}`.slice(0, MAX_EMBEDDING_DOCUMENT_CHARS);
        const contentHash = hashText(documentText);
        const cached = await loadChatEmbedding(scopeId, model.provider, model.modelId, candidate.chatId);
        if (cached?.contentHash !== contentHash || cached.updatedAt !== candidate.updatedAt) {
          pending.push({ candidate, contentHash, documentText });
        }
      }

      for (let offset = 0; offset < pending.length; offset += CHAT_EMBEDDING_BATCH_SIZE) {
        const batch = pending.slice(offset, offset + CHAT_EMBEDDING_BATCH_SIZE);
        const vectors = await embedGeminiTexts({
          ...model,
          items: batch.map((item) => ({
            text: item.documentText,
            title: item.candidate.chatId,
            taskType: 'RETRIEVAL_DOCUMENT',
          })),
          signal: controller.signal,
        });
        await Promise.all(batch.map((item, index) => saveChatEmbedding({
          scopeId,
          chatId: item.candidate.chatId,
          provider: model.provider,
          modelId: model.modelId,
          contentHash: item.contentHash,
          vector: vectors[index],
          updatedAt: item.candidate.updatedAt,
        })));
      }

      completedEmbeddingIndexes.add(indexKey);
    } finally {
      window.clearTimeout(timeout);
    }
  })();

  embeddingIndexPromises.set(indexKey, run);
  try {
    await run;
  } finally {
    if (embeddingIndexPromises.get(indexKey) === run) embeddingIndexPromises.delete(indexKey);
  }
};

export const ChatEmbeddingIndexer: React.FC<{ modelConfig: any }> = ({ modelConfig }) => {
  const { localChats, loadLocalFSChat, getChatTimestamp, chatScopeId } = useLocalFS();
  const { apiKeys } = useUserDataContext();
  const bodyCacheRef = useRef(new Map<string, { updatedAt: number; body: string }>());
  const orderedChats = useMemo(
    () => localChats.map((chatId) => ({ chatId, updatedAt: getChatTimestamp(chatId) })),
    [getChatTimestamp, localChats],
  );

  const loadBody = useCallback(async (candidate: SearchResult): Promise<string> => {
    const cached = bodyCacheRef.current.get(candidate.chatId);
    if (cached?.updatedAt === candidate.updatedAt) return cached.body;
    let body = '';
    try {
      body = flattenMessages(await loadLocalFSChat(candidate.chatId));
    } catch {
      body = '';
    }
    bodyCacheRef.current.set(candidate.chatId, { updatedAt: candidate.updatedAt, body });
    return body;
  }, [loadLocalFSChat]);

  useEffect(() => {
    const embeddingModel = resolveSearchEmbeddingModel(modelConfig, apiKeys);
    if (!embeddingModel || orderedChats.length === 0) return;
    void ensureChatEmbeddingIndex(chatScopeId, embeddingModel, orderedChats, loadBody).catch(() => {
      // The search hook retries and falls back to lexical search if indexing fails.
    });
  }, [apiKeys, chatScopeId, loadBody, modelConfig, orderedChats]);

  return null;
};

/** What the search panel has to show for the query typed into it (`useChatSearch`). */
export interface ChatSearchState {
  /** The query the results (or the skeleton) are for; empty while the panel still shows Recents. */
  query: string;
  results: ChatSearchResult[];
  isSearching: boolean;
}

const NOTHING_SEARCHED: ChatSearchState = { query: '', results: [], isSearching: false };

/**
 * The chats a typed query finds, each with its snippet: by meaning when a search embedding model is
 * set, by the words otherwise. What the panel shows follows Gemini's. Until the debounce
 * (`debounceMs`) has passed it keeps what it showed before (Recents, or the last results). Then it
 * shows the skeleton while the search runs, unless the search is done within the frame, as
 * Gemini's cached answers are. Then it shows every result at once, or none.
 */
export const useChatSearch = (query: string, modelConfig: any, debounceMs = SEARCH_DEBOUNCE_MS): ChatSearchState => {
  const { localChats, loadLocalFSChat, getChatTimestamp, chatScopeId } = useLocalFS();
  const { apiKeys } = useUserDataContext();
  const [shown, setShown] = useState<ChatSearchState>(NOTHING_SEARCHED);
  const bodyCacheRef = useRef(new Map<string, { updatedAt: number; body: string; messages: SnippetMessage[] }>());
  const queryKey = normalize(query).trim();

  const orderedChats = useMemo(
    () => localChats.map((chatId) => ({ chatId, updatedAt: getChatTimestamp(chatId) })),
    [getChatTimestamp, localChats],
  );

  const loadSearchable = useCallback(async (candidate: SearchResult): Promise<{ body: string; messages: SnippetMessage[] }> => {
    const cached = bodyCacheRef.current.get(candidate.chatId);
    if (cached?.updatedAt === candidate.updatedAt) return cached;
    let loaded: unknown = null;
    try {
      loaded = await loadLocalFSChat(candidate.chatId);
    } catch {
      loaded = null;
    }
    const entry = { updatedAt: candidate.updatedAt, body: flattenMessages(loaded), messages: messagesOf(loaded) };
    bodyCacheRef.current.set(candidate.chatId, entry);
    return entry;
  }, [loadLocalFSChat]);

  const loadSearchableBody = useCallback(
    async (candidate: SearchResult): Promise<string> => (await loadSearchable(candidate)).body,
    [loadSearchable],
  );

  useEffect(() => {
    if (!queryKey) {
      setShown(NOTHING_SEARCHED);
      return;
    }

    let cancelled = false;
    let settled = false;
    let skeletonFrame = 0;
    const controller = new AbortController();
    const typed = query.trim();
    const withSnippet = async (candidate: SearchResult): Promise<ChatSearchResult> => ({
      ...candidate,
      snippet: pickSnippet((await loadSearchable(candidate)).messages, typed),
    });

    const runLexicalSearch = async (): Promise<ChatSearchResult[]> => {
      const matches: ChatSearchResult[] = [];
      for (const candidate of orderedChats) {
        if (cancelled || matches.length >= RESULTS_LIMIT) return matches;
        const searchable = await loadSearchableBody(candidate);
        if (normalize(chatDisplayName(candidate.chatId)).includes(queryKey) || normalize(searchable).includes(queryKey)) {
          matches.push(await withSnippet(candidate));
        }
      }
      return matches;
    };

    const timer = window.setTimeout(() => {
      skeletonFrame = window.requestAnimationFrame(() => {
        if (!settled && !cancelled) setShown({ query: typed, results: [], isSearching: true });
      });
      let found: ChatSearchResult[] = [];
      void (async () => {
        const timeout = window.setTimeout(() => controller.abort(), CHAT_SEARCH_TIMEOUT_MS);
        try {
          const embeddingModel = resolveSearchEmbeddingModel(modelConfig, apiKeys);
          if (!embeddingModel) {
            found = await runLexicalSearch();
            return;
          }

          void ensureChatEmbeddingIndex(chatScopeId, embeddingModel, orderedChats, loadSearchableBody).catch(() => {
            // The query can still rank any vectors already cached below.
          });
          const queryVector = await embedGeminiText({
            ...embeddingModel,
            text: query.trim(),
            taskType: 'RETRIEVAL_QUERY',
            signal: controller.signal,
          });
          const ranked: Array<SearchResult & { score: number; lexicalMatch: boolean }> = [];

          for (const candidate of orderedChats) {
            if (cancelled) return;
            const body = await loadSearchableBody(candidate);
            const documentText = `${candidate.chatId}\n\n${body}`.slice(0, MAX_EMBEDDING_DOCUMENT_CHARS);
            const contentHash = hashText(documentText);
            const cached = await loadChatEmbedding(
              chatScopeId,
              embeddingModel.provider,
              embeddingModel.modelId,
              candidate.chatId,
            );
            const vector = cached?.contentHash === contentHash && cached.updatedAt === candidate.updatedAt
              ? cached.vector
              : null;
            if (vector) {
              ranked.push({
                ...candidate,
                score: cosineSimilarity(queryVector, vector),
                lexicalMatch: normalize(candidate.chatId).includes(queryKey) || normalize(body).includes(queryKey),
              });
            }
          }

          const best = ranked
            .filter((candidate) => (
              Number.isFinite(candidate.score) &&
              (candidate.lexicalMatch || candidate.score >= MIN_SEMANTIC_SCORE)
            ))
            .sort((left, right) => right.score - left.score)
            .slice(0, RESULTS_LIMIT)
            .map(({ score: _score, lexicalMatch: _lexicalMatch, ...candidate }) => candidate);
          found = await Promise.all(best.map(withSnippet));
        } catch {
          // An embedding call that failed or ran out of time: the words still find chats.
          if (!cancelled) found = await runLexicalSearch();
        } finally {
          window.clearTimeout(timeout);
          settled = true;
          window.cancelAnimationFrame(skeletonFrame);
          if (!cancelled) setShown({ query: typed, results: found, isSearching: false });
        }
      })();
    }, debounceMs);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
      window.cancelAnimationFrame(skeletonFrame);
    };
  }, [apiKeys, chatScopeId, debounceMs, loadSearchable, loadSearchableBody, modelConfig, orderedChats, query, queryKey]);

  // A cleared field shows Recents at once, not the last results for a frame.
  return queryKey ? shown : NOTHING_SEARCHED;
};

/**
 * Open a chat found by search, on the surface that owns it.
 *
 * A chat started in Code has to reopen in the Code workbench: the chat thread
 * cannot render it, and one message saved from there strips its workbench fields
 * off disk (see `code-chat-open-store`). Publishing the request is the whole job
 * — App performs the navigation — which is why this path must NOT fall through to
 * `onOpenChat`, the callback that forces chat mode.
 *
 * `selectLocalFSInboxChat` is skipped for the same reason as in the sidebar: it
 * would leave the code chat as the active chat, so the next switch to Chat mode
 * would open it there regardless. A chat with no Code marker is read once when
 * nothing has read it yet (`checkCodeChat`), as the sidebar's rows are.
 */
export const openFoundChat = (
  scopeId: string,
  chatId: string,
  selectInboxChat: (chatId: string) => unknown,
  loadChat: (chatId: string) => Promise<unknown[] | null>,
  onOpenChat?: (chatId: string) => void,
): void => {
  void checkCodeChat(scopeId, chatId, loadChat).then((isCode) => {
    if (isCode) {
      requestCodeChatOpen(chatId);
      return;
    }
    void selectInboxChat(chatId);
    onOpenChat?.(chatId);
  });
};
