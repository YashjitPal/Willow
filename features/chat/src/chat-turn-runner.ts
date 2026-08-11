import { streamChat, isAbortError, type StreamPhase } from '@willow/ai/chat';
import type { MessageCitations } from '@willow/ai/grounding';
import type { ChatMessage as AiChatMessage } from '@willow/ai/chat';
import { runPersonalTool } from '@willow/personal';
import { type ChatMsg, hasSavedMessageContent, serializeChatMessage } from './chat-message';
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

  try {
    await deps.attachmentPersistence;
    await streamChat(
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
        // Personalization tools, or none. Gated by the caller: empty in a
        // temporary chat, empty when Memory is off, and empty when there is
        // nothing stored and nothing connected — which is what keeps a model
        // from being told it can look up a user it knows nothing about.
        personalTools: deps.personalTools,
        baseUrl: options.baseUrl,
        signal: record.abort.signal,
      },
      (token: string) => {
        if (!isCurrent(record, deps)) return;
        if (record.isThinking) {
          record.thinkSeconds = Math.max(1, Math.ceil((Date.now() - record.thinkStartedAt) / 1000));
          stopThinking();
        }
        record.content += token;
        // Only a watching view pushes into React. An unwatched turn just grows
        // its accumulator, which is what keeps a background stream off the
        // render path entirely.
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
      // Tool executor. Only personal tools are declared on a chat turn, and
      // `runPersonalTool` returns null for anything else, which surfaces to the
      // model as the "tool not available" message rather than a silent success.
      async (name: string, args: any) => {
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
    );
    // Some SDKs swallow the abort and return normally instead of throwing, so a
    // clean return is not proof the turn ran to completion.
    record.wasStopped = record.abort.signal.aborted;
    record.finalContent = record.content;
  } catch (error: any) {
    if (record.abort.signal.aborted || isAbortError(error)) {
      record.wasStopped = true;
      record.finalContent = record.content;
    } else {
      record.isError = true;
      record.finalContent = `Something went wrong: ${error?.message || 'Unknown error.'}`;
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
