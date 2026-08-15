import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { embedGeminiText, embedGeminiTexts } from '@willow/ai/embeddings';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import { loadChatEmbedding, saveChatEmbedding } from '@willow/storage/indexeddb/willow-db';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { finishTopLoadingReason, startTopLoadingReason } from '@willow/ui/top-loading-store';
import './SearchChats.css';

type SearchChatsProps = {
  onOpenChat?: (chatId: string) => void;
  autoFocus?: boolean;
  compact?: boolean;
  onClose?: () => void;
  modelConfig: any;
};

type SearchResult = {
  chatId: string;
  updatedAt: number;
};

const normalize = (value: unknown): string => String(value ?? '').toLocaleLowerCase();

const formatChatDate = (timestamp: number): string => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();

  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (isToday) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  if (isYesterday) return 'Yesterday';

  if (date.getFullYear() !== now.getFullYear()) {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  }

  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
};

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

  const loadingReason = `chat-search:index:${hashText(indexKey)}`;
  const run = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CHAT_EMBEDDING_INDEX_TIMEOUT_MS);
    startTopLoadingReason(loadingReason);
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
      finishTopLoadingReason(loadingReason);
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

export const useChatSearch = (query: string, modelConfig: any): {
  results: SearchResult[];
  isSearching: boolean;
} => {
  const { localChats, loadLocalFSChat, getChatTimestamp, chatScopeId } = useLocalFS();
  const { apiKeys } = useUserDataContext();
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const bodyCacheRef = useRef(new Map<string, { updatedAt: number; body: string }>());
  const searchGenerationRef = useRef(0);
  const queryKey = normalize(query).trim();

  const orderedChats = useMemo(
    () => localChats.map((chatId) => ({ chatId, updatedAt: getChatTimestamp(chatId) })),
    [getChatTimestamp, localChats],
  );

  const results = queryKey ? searchResults : orderedChats;

  const loadSearchableBody = useCallback(async (candidate: SearchResult): Promise<string> => {
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
    if (!queryKey) {
      setIsSearching(false);
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const searchGeneration = ++searchGenerationRef.current;
    const loadingReason = `chat-search:${searchGeneration}`;

    const runLexicalSearch = async (): Promise<SearchResult[]> => {
      const matches: SearchResult[] = [];
      for (const candidate of orderedChats) {
        if (cancelled) return matches;
        const searchable = await loadSearchableBody(candidate);
        if (normalize(candidate.chatId).includes(queryKey) || normalize(searchable).includes(queryKey)) {
          matches.push(candidate);
          if (!cancelled) setSearchResults([...matches]);
        }
      }
      return matches;
    };

    setIsSearching(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        startTopLoadingReason(loadingReason);
        const timeout = window.setTimeout(() => controller.abort(), CHAT_SEARCH_TIMEOUT_MS);
        try {
          const embeddingModel = resolveSearchEmbeddingModel(modelConfig, apiKeys);
          if (!embeddingModel) {
            const matches = await runLexicalSearch();
            if (!cancelled) setSearchResults(matches);
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

          if (!cancelled) {
            setSearchResults(
              ranked
                .filter((candidate) => (
                  Number.isFinite(candidate.score) &&
                  (candidate.lexicalMatch || candidate.score >= MIN_SEMANTIC_SCORE)
                ))
                .sort((left, right) => right.score - left.score)
                .slice(0, 30)
                .map(({ score: _score, lexicalMatch: _lexicalMatch, ...candidate }) => candidate),
            );
          }
        } catch (error) {
          if (!cancelled && (error as Error)?.name !== 'AbortError') {
            const matches = await runLexicalSearch();
            if (!cancelled) setSearchResults(matches);
          }
        } finally {
          window.clearTimeout(timeout);
          finishTopLoadingReason(loadingReason);
          if (!cancelled && searchGenerationRef.current === searchGeneration) setIsSearching(false);
        }
      })();
    }, 120);

    return () => {
      cancelled = true;
      controller.abort();
      finishTopLoadingReason(loadingReason);
      window.clearTimeout(timer);
      if (searchGenerationRef.current === searchGeneration) setIsSearching(false);
    };
  }, [apiKeys, chatScopeId, loadSearchableBody, modelConfig, orderedChats, query, queryKey]);

  return { results, isSearching };
};

const SearchBar: React.FC<{
  query: string;
  onQueryChange: (value: string) => void;
  autoFocus?: boolean;
  compact?: boolean;
  onClose?: () => void;
}> = ({ query, onQueryChange, autoFocus = false, compact = false, onClose }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [autoFocus]);

  return (
    <div className={`willow-search-bar ${compact ? 'willow-search-bar--compact' : ''}`}>
      <span className="willow-search-bar__icon" aria-hidden="true">
        <MaterialSymbol
          family="luminous"
          name="search"
          size={24}
          weight={320}
          opticalSize={24}
        />
      </span>
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        type="text"
        placeholder="Search chats"
        aria-label="Search chats"
        className="willow-search-bar__input"
      />
      {query && (
        <button type="button" className="willow-search-bar__clear" aria-label="Clear search" onClick={() => onQueryChange('')}>
          <X size={20} strokeWidth={2} />
        </button>
      )}
      {onClose && (
        <button type="button" className="willow-search-bar__close" aria-label="Close search" onClick={onClose}>
          <X size={20} strokeWidth={2} />
        </button>
      )}
    </div>
  );
};

const SearchResults: React.FC<{
  query: string;
  results: SearchResult[];
  isSearching: boolean;
  onOpenChat?: (chatId: string) => void;
  compact?: boolean;
}> = ({ query, results, isSearching, onOpenChat, compact = false }) => (
  <div className={`willow-search-results ${compact ? 'willow-search-results--compact' : ''}`}>
    <div className="willow-search-results__header">
      <h2 className="willow-search-results__heading">Recent</h2>
    </div>
    <div className="willow-search-results__list">
      <div className="willow-search-results__inner">
        {results.map((result) => (
          <button
            type="button"
            key={result.chatId}
            className="willow-search-result"
            onClick={() => onOpenChat?.(result.chatId)}
          >
            <span className="willow-search-result__title">{result.chatId}</span>
            <span className="willow-search-result__date">{formatChatDate(result.updatedAt)}</span>
          </button>
        ))}
        {!isSearching && query.trim() && results.length === 0 && (
          <div className="willow-search-empty">No chats found with this keyword</div>
        )}
      </div>
    </div>
  </div>
);

export const SearchChatsPage: React.FC<{ onOpenChat?: (chatId: string) => void; modelConfig: any }> = ({ onOpenChat, modelConfig }) => {
  const [query, setQuery] = useState('');
  const { results, isSearching } = useChatSearch(query, modelConfig);
  const { selectLocalFSInboxChat, isChatListHydrated } = useLocalFS();

  useEffect(() => {
    const loadingReason = 'search-chats-hydrating';
    if (!isChatListHydrated) {
      startTopLoadingReason(loadingReason);
    } else {
      finishTopLoadingReason(loadingReason);
    }
    return () => {
      finishTopLoadingReason(loadingReason);
    };
  }, [isChatListHydrated]);

  return (
    <section className="willow-search-page" aria-label="Search chats">
      <SearchBar query={query} onQueryChange={setQuery} autoFocus />
      {isChatListHydrated ? (
        <SearchResults
          query={query}
          results={results}
          isSearching={isSearching}
          onOpenChat={(chatId) => {
            void selectLocalFSInboxChat(chatId);
            onOpenChat?.(chatId);
          }}
        />
      ) : (
        <div className="willow-search-results" />
      )}
    </section>
  );
};

export const SearchChatsDialog: React.FC<SearchChatsProps> = ({ onOpenChat, autoFocus = true, onClose, modelConfig }) => {
  const [query, setQuery] = useState('');
  const { results, isSearching } = useChatSearch(query, modelConfig);
  const { selectLocalFSInboxChat, isChatListHydrated } = useLocalFS();

  useEffect(() => {
    const loadingReason = 'search-dialog-hydrating';
    if (!isChatListHydrated) {
      startTopLoadingReason(loadingReason);
    } else {
      finishTopLoadingReason(loadingReason);
    }
    return () => {
      finishTopLoadingReason(loadingReason);
    };
  }, [isChatListHydrated]);

  return (
    <div className="willow-search-dialog" role="dialog" aria-modal="true" aria-label="Search chats">
      <SearchBar query={query} onQueryChange={setQuery} autoFocus={autoFocus} compact onClose={onClose} />
      {isChatListHydrated ? (
        <SearchResults
          query={query}
          results={results}
          isSearching={isSearching}
          onOpenChat={(chatId) => {
            void selectLocalFSInboxChat(chatId);
            onOpenChat?.(chatId);
            onClose?.();
          }}
          compact
        />
      ) : (
        <div className="willow-search-results willow-search-results--compact" />
      )}
    </div>
  );
};
