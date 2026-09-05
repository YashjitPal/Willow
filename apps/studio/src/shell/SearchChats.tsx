import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { embedGeminiText, embedGeminiTexts } from '@willow/ai/embeddings';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import { loadChatEmbedding, saveChatEmbedding } from '@willow/storage/indexeddb/willow-db';
import { chatDisplayName } from '@willow/storage/local-fs/chat-metadata';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { finishTopLoadingReason, startTopLoadingReason } from '@willow/ui/top-loading-store';
import { createChatBodyLoader, hashText, normalize, runChatSearch, type SearchResult } from './chat-search';
import './SearchChats.css';

type SearchChatsProps = {
  onOpenChat?: (chatId: string) => void;
  autoFocus?: boolean;
  compact?: boolean;
  onClose?: () => void;
  modelConfig: any;
};

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

const MAX_EMBEDDING_DOCUMENT_CHARS = 24_000;
const CHAT_EMBEDDING_BATCH_SIZE = 20;
const CHAT_EMBEDDING_INDEX_TIMEOUT_MS = 60_000;

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
  const orderedChats = useMemo(
    () => localChats.map((chatId) => ({ chatId, updatedAt: getChatTimestamp(chatId) })),
    [getChatTimestamp, localChats],
  );

  const loadBody = useMemo(
    () => createChatBodyLoader(loadLocalFSChat),
    [chatScopeId, loadLocalFSChat],
  );

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
  const searchId = useId();
  const searchGenerationRef = useRef(0);
  const queryKey = normalize(query).trim();
  const orderedChats = useMemo(
    () => localChats.map((chatId) => ({ chatId, updatedAt: getChatTimestamp(chatId) })),
    [getChatTimestamp, localChats],
  );
  const loadSearchableBody = useMemo(
    () => createChatBodyLoader(loadLocalFSChat),
    [chatScopeId, loadLocalFSChat],
  );
  // Identity changes during render, so old results cannot flash before effect cleanup.
  const request = useMemo(() => ({ queryKey, chatScopeId }),
    [query, queryKey, chatScopeId, apiKeys, modelConfig, orderedChats, loadSearchableBody]);
  const [search, setSearch] = useState<{ request: typeof request; results: SearchResult[]; pending: boolean } | null>(null);

  useEffect(() => {
    if (!queryKey) return;
    const controller = new AbortController();
    const loadingReason = `chat-search:${searchId}:${++searchGenerationRef.current}`;
    setSearch({ request, results: [], pending: true });
    const timer = window.setTimeout(() => {
      startTopLoadingReason(loadingReason);
      const embeddingModel = resolveSearchEmbeddingModel(modelConfig, apiKeys);
      void runChatSearch({
        query: queryKey,
        chats: orderedChats,
        loadBody: loadSearchableBody,
        signal: controller.signal,
        onResults: (results) => setSearch({ request, results, pending: true }),
        semantic: embeddingModel ? {
          embedQuery: (signal) => {
            void ensureChatEmbeddingIndex(chatScopeId, embeddingModel, orderedChats, loadSearchableBody).catch(() => {
              // Search can use cached vectors and text matches while indexing retries.
            });
            return embedGeminiText({ ...embeddingModel, text: query.trim(), taskType: 'RETRIEVAL_QUERY', signal });
          },
          loadVector: async (candidate, body) => {
            const documentText = `${candidate.chatId}\n\n${body}`.slice(0, MAX_EMBEDDING_DOCUMENT_CHARS);
            const cached = await loadChatEmbedding(chatScopeId, embeddingModel.provider, embeddingModel.modelId, candidate.chatId);
            return cached?.contentHash === hashText(documentText) && cached.updatedAt === candidate.updatedAt
              ? cached.vector : null;
          },
        } : undefined,
      }).finally(() => {
        finishTopLoadingReason(loadingReason);
        if (!controller.signal.aborted) {
          setSearch((current) => current?.request === request ? { ...current, pending: false } : current);
        }
      });
    }, 120);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      finishTopLoadingReason(loadingReason);
    };
  }, [request]);

  return {
    results: !queryKey ? orderedChats : search?.request === request ? search.results : [],
    isSearching: Boolean(queryKey) && (search?.request !== request || search.pending),
  };
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
            <span className="willow-search-result__title">{chatDisplayName(result.chatId)}</span>
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
