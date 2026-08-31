import { streamChat, isAbortError, type StreamPhase } from '@willow/ai/chat';
import type { ProviderApiFormat, ProviderToolPolicy } from '@willow/ai/providers/profiles';
import type { MessageCitations, GroundingSource } from '@willow/ai/grounding';
import type { CodeExecution } from '@willow/ai/code-execution';
import type { ChatMessage as AiChatMessage } from '@willow/ai/chat';
import { runPersonalTool } from '@willow/personal';
import { declaredToolNames } from './personal-tools';
import { createCanvasToolExecutor, type CanvasToolHost } from './canvas/canvas-runtime';
import { isCanvasToolCall } from './canvas/canvas-tools';
import { WEB_SEARCH_TOOL_NAME, formatWebSearchResult } from '@willow/ai/web-search-tool';
import { type ChatMsg, hasSavedMessageContent, serializeChatMessage } from './chat-message';
import {
  formatUpstreamError,
  friendlyChatErrorFor,
  MAX_UPSTREAM_RETRIES,
  UPSTREAM_RETRY_DELAYS_MS,
} from './chat-errors';
import {
  claimChatTurnSettlement,
  getChatTurn,
  removeChatTurn,
  type ChatTurnRecord,
} from './chat-turn-store';

/**
 * Drives one chat turn to completion, independent of any React component.
 *
 * Everything the turn needs is on the record or in `deps`; nothing is read from
 * a closure over component state. That is what lets a response keep streaming
 * after the user leaves the chat — or after ChatView is unmounted outright by
 * the Code tab, New Chat or Incognito.
 *
 * The storage callbacks are safe to capture across an unmount: `saveLocalFSChat`
 * reads all of its state through refs, so a stale function identity still sees
 * current data. Same input-object shape as `chat-history.ts` / `chat-model.ts`.
 */

/** Seconds the thinking row shows before the first token. */
const THINK_TICK_MS = 1000;

/**
 * Gap between durable checkpoints of a partial response.
 *
 * Deliberately not tighter. Every save bumps the chat's timestamp and
 * re-persists metadata, and Recents is sorted newest-first — a faster cadence
 * would repeatedly shove the chat to the top of the sidebar and redraw it, which
 * is the background indicator this feature deliberately does not have.
 */
const CHECKPOINT_INTERVAL_MS = 2000;

/** Save retries for a completed background turn. Unlike the autosave effect,
 *  the runner has no "next save" to subsume a failed one. */
const SAVE_RETRY_DELAYS_MS = [500, 2000, 8000];

export interface ChatTurnRunnerDeps {
  /** Resolved provider options for this turn. */
  options: {
    provider: string;
    model: string;
    apiKey: string;
    thinkingLevel: number;
    baseUrl?: string;
    apiFormat?: ProviderApiFormat;
    toolPolicy?: ProviderToolPolicy;
    profileId?: string;
    reasoningEffort?: string;
  };
  systemPrompt: string;
  /**
   * Personalization tools to declare, already gated.
   *
   * Empty when Memory is off or this is a temporary chat. Computed by the
   * caller — the component knows whether the chat is temporary, and the runner
   * is deliberately free of that question. `personalChatTools` exists so the two
   * sides (prompt flag + tool list) cannot drift; both derive from the same
   * `personalize` value.
   */
  personalTools: { functionDeclarations: any[] }[];
  /**
   * Canvas tool declarations, empty unless the user attached the Canvas chip.
   *
   * Kept separate from `personalTools` rather than concatenated, because the two
   * are gated by different things and executed by different code: the
   * personalization gate is a settings switch, this one is a per-message choice,
   * and `declaredToolNames(personalTools)` is what decides whether a call reaches
   * `runPersonalTool`. Merging them would have let a canvas call fall through to
   * the personal executor and come back "not available".
   */
  canvasTools?: { functionDeclarations: any[] }[];
  /**
   * Everything the Canvas executor needs except the two things only the runner
   * knows: how much reply text has been written, and where to put a new
   * revision. Absent when Canvas is off for this turn.
   */
  canvasHost?: Omit<CanvasToolHost, 'contentLength' | 'publish'>;
  /**
   * Willow's OWN web search, declared as a client tool.
   *
   * Present only when the endpoint cannot search for itself — see
   * `webSearchToolDeclaration`. The runner does not decide that: the component
   * knows the profile's Tool translation setting and whether a Gemini key exists
   * to answer with, and both have to agree with the declaration or the model calls
   * a tool nothing can run.
   */
  webSearchTools?: { functionDeclarations: any[] }[];
  /** Answers `web_search`. Absent exactly when `webSearchTools` is. */
  runWebSearch?: (query: string) => Promise<{ text: string; sources: GroundingSource[] }>;
  /** Wire-format history, already built (it needs attachment bytes, which only
   *  the component can resolve). */
  history: AiChatMessage[];
  /** Resolves once this turn's attachments are durable. */
  attachmentPersistence: Promise<unknown>;
  /** The scope the turn must still be in to write anything. */
  currentScopeId: () => string;
  saveChat: (chatId: string, messages: any[], oldChatId?: string | null) => Promise<boolean>;
}

/** A turn may only touch state while it is still the live turn, in its original
 *  scope. Mirrors Spark's `isCurrentRun`, re-checked on every callback. */
const isCurrent = (record: ChatTurnRecord, deps: ChatTurnRunnerDeps): boolean =>
  getChatTurn(record.turnId) === record && deps.currentScopeId() === record.scopeId;

const buildAssistantMessage = (record: ChatTurnRecord, content: string, wasStopped: boolean): ChatMsg => ({
  id: record.assistantId,
  role: 'assistant',
  content,
  thinkingTime: record.thinkSeconds || undefined,
  thinkingText: record.thinkingText || undefined,
  modelSnapshot: record.modelSnapshot,
  isError: record.isError,
  wasStopped,
  citations: record.citations,
  codeExecutions: record.codeExecutions?.length ? record.codeExecutions : undefined,
  canvasRefs: record.canvasRefs?.length ? record.canvasRefs : undefined,
});

const buildThread = (record: ChatTurnRecord, assistant: ChatMsg): any[] =>
  [...record.historyBefore, record.userMessage, assistant]
    .map(serializeChatMessage)
    .filter(hasSavedMessageContent);

/**
 * Persist a partial response so a killed tab does not lose it.
 *
 * Written as a stopped turn. `wasStopped` already means "this response ended
 * early but keep it": `hasSavedMessageContent` retains such a turn even with no
 * text, the load path reads the flag back, and the thread renders the
 * "You stopped this response" divider. So a tab that dies at any moment has
 * correct state on disk with no unload-time work — which is the only honest
 * option, since IndexedDB writes started during unload routinely never commit.
 *
 * A successful completion overwrites this with `wasStopped: false`.
 */
const checkpoint = async (record: ChatTurnRecord, deps: ChatTurnRunnerDeps): Promise<void> => {
  if (record.isIncognito) return;
  const now = Date.now();
  if (now - record.lastCheckpointAt < CHECKPOINT_INTERVAL_MS) return;
  if (!record.content && !record.thinkingText) return;
  record.lastCheckpointAt = now;
  if (!isCurrent(record, deps)) return;
  try {
    // chatId is re-read here, never captured: a rename may have landed mid-stream.
    await deps.saveChat(record.chatId, buildThread(record, buildAssistantMessage(record, record.content, true)));
  } catch {
    // Best effort. The next checkpoint, or the final save, subsumes it.
  }
};

/** Save a finished turn nobody is watching. */
const persistSettledTurn = async (record: ChatTurnRecord, deps: ChatTurnRunnerDeps): Promise<void> => {
  if (record.isIncognito) {
    record.persisted = true;
    removeChatTurn(record.turnId);
    return;
  }
  const assistant = buildAssistantMessage(record, record.finalContent, record.wasStopped);
  const thread = buildThread(record, assistant);

  for (let attempt = 0; attempt <= SAVE_RETRY_DELAYS_MS.length; attempt += 1) {
    if (!isCurrent(record, deps)) return;
    let saved: boolean | undefined;
    try {
      saved = await deps.saveChat(record.chatId, thread);
    } catch {
      saved = false;
    }
    // `saveLocalFSChat` returns undefined while the chat scope is switching and
    // false on a name collision, so this is a truthiness test, matching the
    // autosave effect.
    if (saved) {
      record.persisted = true;
      removeChatTurn(record.turnId);
      return;
    }
    const delay = SAVE_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) break;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  // Out of retries. Keep the record: the next ChatView to open this chat commits
  // it into `messages` and the normal autosave path takes over.
};

/**
 * Run the turn. Resolves when it has settled (and, if unwatched, been saved).
 *
 * Never throws: a turn is terminal state, not an exception, and the caller is
 * usually a fire-and-forget `void`.
 */
export const runChatTurn = async (
  record: ChatTurnRecord,
  deps: ChatTurnRunnerDeps,
): Promise<void> => {
  const { options } = deps;

  const thinkTimer = setInterval(() => {
    if (!record.isThinking) return;
    record.thinkSeconds = Math.ceil((Date.now() - record.thinkStartedAt) / 1000);
    record.listener?.onPhase(record);
  }, THINK_TICK_MS);

  const stopThinking = () => {
    record.isThinking = false;
  };

  /*
   * The Canvas executor is rebuilt per attempt, not per turn.
   *
   * It carries this-attempt state (the revisions made so far, which
   * `update_canvas` reads to find the document's current text), so reusing one
   * across an upstream retry would leave the second attempt editing a document
   * the user never saw a first version of — and `record.canvasRefs` is cleared on
   * retry, so the two would then disagree about what exists.
   */
  const makeCanvasExecutor = () => {
    const host = deps.canvasHost;
    if (!host) return null;
    return createCanvasToolExecutor({
      ...host,
      contentLength: () => record.content.length,
      publish: (ref) => {
        record.canvasRefs = [...(record.canvasRefs ?? []), ref];
        // Like code executions and unlike citations, this is visible the instant
        // it lands, so the view has to be told rather than picking it up at
        // settle time.
        record.listener?.onPhase(record);
        void checkpoint(record, deps);
      },
    });
  };
  let runCanvasTool = makeCanvasExecutor();

  const resetForRetry = () => {
    record.content = '';
    record.thinkingText = '';
    record.citations = undefined;
    record.codeExecutions = undefined;
    record.canvasRefs = undefined;
    record.phase = 'thinking';
    record.isThinking = true;
    record.thinkStartedAt = Date.now();
    runCanvasTool = makeCanvasExecutor();
    record.listener?.onText('');
    record.listener?.onThinking(record);
    record.listener?.onPhase(record);
  };

  const waitForRetry = (delay: number): Promise<boolean> => new Promise((resolve) => {
    if (record.abort.signal.aborted) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      record.abort.signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, delay);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    record.abort.signal.addEventListener('abort', onAbort, { once: true });
  });

  const runStreamAttempt = () => streamChat(
    deps.history,
    // Chat mode: search grounding + native code execution both offered.
    {
      provider: options.provider,
      model: options.model,
      apiKey: options.apiKey,
      thinkingLevel: options.thinkingLevel,
      includeThoughts: options.thinkingLevel > 0,
      enableSearch: true,
      enableCodeExecution: true,
      personalTools: deps.personalTools,
      /* Canvas plus Willow's own search, when this endpoint needs one supplied.
         Both are client function declarations and both are answered below, so they
         travel together — the adapters know nothing about which is which. */
      toolDeclarations: [...(deps.canvasTools ?? []), ...(deps.webSearchTools ?? [])],
      baseUrl: options.baseUrl,
      apiFormat: options.apiFormat,
      toolPolicy: options.toolPolicy,
      profileId: options.profileId,
      reasoningEffort: options.reasoningEffort,
      signal: record.abort.signal,
    },
    (token: string) => {
      if (!isCurrent(record, deps)) return;
      if (record.isThinking) {
        record.thinkSeconds = Math.max(1, Math.ceil((Date.now() - record.thinkStartedAt) / 1000));
        stopThinking();
      }
      record.content += token;
      record.listener?.onText(record.content);
      void checkpoint(record, deps);
    },
    () => {},
    deps.systemPrompt,
    (phase: StreamPhase) => {
      if (!isCurrent(record, deps)) return;
      record.phase = phase;
      record.listener?.onPhase(record);
    },
    async (name: string, args: any) => {
      /*
       * Canvas first, and gated on the executor rather than on the name.
       *
       * `runCanvasTool` is null exactly when the declarations were not sent, so
       * one check covers both halves: a model that remembers `create_canvas` from
       * three turns ago and calls it on a turn where Canvas is off falls through
       * to the refusal below instead of quietly writing a document into a message
       * whose thread has no panel open.
       */
      if (runCanvasTool && isCanvasToolCall(name)) {
        if (!isCurrent(record, deps)) {
          return { status: 'error', error: 'This conversation is no longer active.' };
        }
        return runCanvasTool(name, args);
      }

      /*
       * Willow's own web search, gated on the executor for the same reason.
       *
       * The sources are merged onto the turn as well as returned to the model, so a
       * searched answer gets the same source cards a provider-native search would —
       * the panel reads `record.citations`, and it does not care which tool filled
       * it. Spans are not synthesised: these offsets index a document the calling
       * model never saw, so the sources render as cards and not as inline chips.
       */
      if (deps.runWebSearch && name === WEB_SEARCH_TOOL_NAME) {
        if (!isCurrent(record, deps)) {
          return { status: 'error', error: 'This conversation is no longer active.' };
        }
        const query = typeof args?.query === 'string' ? args.query.trim() : '';
        if (!query) {
          return { status: 'error', error: 'No query was provided. Call again with a `query` string.' };
        }
        const found = await deps.runWebSearch(query);
        if (found.sources.length && isCurrent(record, deps)) {
          const existing = record.citations?.sources ?? [];
          const seen = new Set(existing.map((source) => source.uri));
          const merged = [...existing, ...found.sources.filter((source) => !seen.has(source.uri))];
          record.citations = { sources: merged, citations: record.citations?.citations ?? [] };
          record.listener?.onPhase(record);
          void checkpoint(record, deps);
        }
        return { status: 'ok', result: formatWebSearchResult(found) };
      }

      /*
       * Refuse anything this turn did not declare, before it can run.
       *
       * Declaring no tools is supposed to make them uncallable, and usually does.
       * But a model reading a transcript in which it called `list_liked_videos`
       * three turns ago can emit that call again on a turn where the tool was never
       * offered, and without this check it would execute — so turning
       * personalization off would have stopped the model being told about the
       * user's connected apps without stopping it reaching them.
       *
       * Cheap, and it fails the same way an unknown tool already does, so the model
       * gets a reply it knows how to handle rather than a silent nothing.
       */
      const allowed = declaredToolNames(deps.personalTools);
      if (!allowed.has(name)) {
        return {
          status: 'error',
          error: `The tool "${name}" is not available in this context. Do not claim it ran; use another approach or tell the user plainly.`,
        };
      }

      const result = await runPersonalTool(name, args);
      if (!result) {
        return {
          status: 'error',
          error: `The tool "${name}" is not available in this context. Do not claim it ran; use another approach or tell the user plainly.`,
        };
      }
      return { status: 'ok', result: result.text };
    },
    (thoughtChunk: string) => {
      if (!isCurrent(record, deps)) return;
      record.thinkingText += thoughtChunk;
      record.listener?.onThinking(record);
    },
    (citations: MessageCitations) => {
      if (!isCurrent(record, deps)) return;
      record.citations = citations;
    },
    (executions: CodeExecution[]) => {
      if (!isCurrent(record, deps)) return;
      record.codeExecutions = executions;
      // Unlike citations, these land mid-stream and are visible immediately, so
      // the view has to be told rather than picking them up at settle time.
      record.listener?.onPhase(record);
      void checkpoint(record, deps);
    },
  );

  try {
    await deps.attachmentPersistence;
    for (let retry = 0; retry <= MAX_UPSTREAM_RETRIES; retry += 1) {
      try {
        await runStreamAttempt();
        // Some SDKs swallow the abort and return normally, so a clean return is
        // not proof the turn ran to completion.
        record.wasStopped = record.abort.signal.aborted;
        record.finalContent = record.content;
        break;
      } catch (error: any) {
        if (record.abort.signal.aborted || isAbortError(error)) throw error;
        if (retry === MAX_UPSTREAM_RETRIES) {
          record.isError = true;
          record.errorDetail = formatUpstreamError(error);
          record.content = '';
          record.thinkingText = '';
          record.citations = undefined;
          record.codeExecutions = undefined;
          record.canvasRefs = undefined;
          record.listener?.onText('');
          record.finalContent = friendlyChatErrorFor(record.historyBefore);
          break;
        }
        resetForRetry();
        const continued = await waitForRetry(UPSTREAM_RETRY_DELAYS_MS[retry]);
        if (!continued) throw new DOMException('The AI request was cancelled.', 'AbortError');
      }
    }
  } catch (error: any) {
    if (record.abort.signal.aborted || isAbortError(error)) {
      record.wasStopped = true;
      record.finalContent = record.content;
    } else {
      record.isError = true;
      record.errorDetail = formatUpstreamError(error);
      record.content = '';
      // An error turn renders the friendly message and nothing else, so a canvas
      // card left attached here would sit under an apology pointing at a document
      // the user was never shown.
      record.canvasRefs = undefined;
      record.listener?.onText('');
      record.finalContent = friendlyChatErrorFor(record.historyBefore);
    }
  } finally {
    clearInterval(thinkTimer);
    stopThinking();
  }

  // Claimed synchronously: an attached view finalises through its own state (and
  // its autosave effect writes), otherwise the runner saves. Splitting this
  // across an await would let a detach land in between and leave the turn saved
  // by nobody — or by both, and `saveLocalFSChat` is a whole-file replace.
  const owner = claimChatTurnSettlement(record.turnId);
  if (owner === null) return;

  if (owner === 'view') {
    record.listener?.onSettled(record);
    record.persisted = true;
    removeChatTurn(record.turnId);
    return;
  }
  await persistSettledTurn(record, deps);
};
