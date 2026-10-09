import {
  registerBackgroundJobKind,
  startBackgroundJob,
  type BackgroundJob,
  type BackgroundJobHandle,
} from '@willow/core/background-jobs';
import type { ChatAttachment } from '@willow/core/attachments';
import type { StoredChatAttachment } from '@willow/storage/indexeddb/willow-db';
import { decodeCanvasHistory } from './canvas/canvas-diff';
import { buildAiHistory } from './chat-history';
import {
  hasSavedMessageContent,
  restoreSavedChatMessage,
  sanitizeSavedAttachment,
  serializeChatMessage,
  type ChatMsg,
} from './chat-message';
import { resolveChatModel } from './chat-model';
import { getChatTurn, registerChatTurn, type ChatTurnRecord } from './chat-turn-store';
import { runChatTurn, type ChatTurnRunnerDeps } from './chat-turn-runner';
import { buildChatTurnSetup, resolveChatTurnGrounding, type ChatTurnChoices } from './chat-turn-setup';

/**
 * A chat reply that carries on in another tab.
 *
 * Every saved turn is also a background job (`@willow/core/background-jobs`).
 * When the tab writing a reply closes, another open Willow tab picks the job up
 * here: it reads the chat back from disk, finds the question, and generates the
 * reply again under the same message id. The partial text the closed tab
 * checkpointed is replaced as the new reply streams, through the same runner,
 * saves and attach path as a turn started in this tab.
 *
 * Regenerated rather than continued: a provider cannot be relied on to carry on
 * from half a message, and a reply that restarts reads better than one that
 * repeats or contradicts its own first half.
 */

export const CHAT_TURN_JOB = 'chat-turn';

export interface ChatTurnJob extends ChatTurnChoices {
  /** The chat's current id; follows the rename from a temporary id to its title. */
  chatId: string;
  turnId: string;
  /** The model the sender picked. Model choice is per tab, so the resuming tab is told. */
  selectedModelId: string;
  /** The question, for a tab that closed before any checkpoint wrote it. */
  userMessage: ReturnType<typeof serializeChatMessage>;
}

export const startChatTurnJob = (
  record: ChatTurnRecord,
  choices: ChatTurnChoices & { selectedModelId: string },
): BackgroundJobHandle<ChatTurnJob> => {
  const job = startBackgroundJob<ChatTurnJob>({
    id: `chat:${record.scopeId}:${record.turnId}`,
    kind: CHAT_TURN_JOB,
    scopeId: record.scopeId,
    payload: {
      chatId: record.chatId,
      turnId: record.turnId,
      userMessage: serializeChatMessage(record.userMessage),
      ...choices,
    },
  });
  record.job = job;
  return job;
};

export interface ChatTurnTakeoverEnv {
  scopeId: () => string;
  modelConfig: () => any;
  apiKeys: () => any;
  loadChat: (chatId: string) => Promise<any[] | null | undefined>;
  loadAttachment: (attachmentId: string) => Promise<StoredChatAttachment | null>;
  saveChat: ChatTurnRunnerDeps['saveChat'];
}

/* Metadata only: the bytes are read from storage when the history is built. */
const savedAttachments = (value: unknown): ChatAttachment[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const kept = value.map(sanitizeSavedAttachment).filter((item): item is ChatAttachment => Boolean(item));
  return kept.length ? kept : undefined;
};

const restoreThread = (saved: any[]): ChatMsg[] => decodeCanvasHistory(saved)
  .map((message: any) => restoreSavedChatMessage(message, savedAttachments(message.attachments)))
  .filter(hasSavedMessageContent);

export const resumeChatTurn = async (job: BackgroundJob<ChatTurnJob>, env: ChatTurnTakeoverEnv): Promise<void> => {
  const { chatId, turnId, selectedModelId, userMessage, notebookId, gemId, tool } = job.payload;
  if (getChatTurn(turnId)) return;
  const modelConfig = env.modelConfig();
  const apiKeys = env.apiKeys();
  const model = resolveChatModel({ modelConfig, selectedModelId, apiKeys });
  if (!model.apiKey) return;

  const thread = restoreThread((await env.loadChat(chatId).catch(() => null)) ?? []);
  const userIndex = thread.findIndex((message) => message.id === userMessage.id);
  const question = userIndex >= 0
    ? thread[userIndex]
    : restoreSavedChatMessage(userMessage, savedAttachments(userMessage.attachments));
  const historyBefore = (userIndex >= 0 ? thread.slice(0, userIndex) : thread)
    .filter((message) => message.id !== turnId);

  const now = Date.now();
  const record: ChatTurnRecord = {
    turnId,
    chatId,
    chatIdHistory: [],
    scopeId: job.scopeId,
    isIncognito: false,
    historyBefore,
    userMessage: question,
    assistantId: turnId,
    modelSnapshot: {
      provider: model.provider,
      modelId: model.model,
      label: model.modelLabel,
      thinkingLevel: model.thinkingLevel,
    },
    content: '',
    thinkingText: '',
    citations: undefined,
    phase: 'thinking',
    isThinking: true,
    thinkStartedAt: now,
    thinkSeconds: 0,
    abort: new AbortController(),
    status: 'running',
    settledBy: null,
    wasStopped: false,
    isError: false,
    errorDetail: undefined,
    finalContent: '',
    persisted: false,
    lastCheckpointAt: now,
    listener: null,
  };
  const handle = startChatTurnJob(record, { selectedModelId, notebookId, gemId, tool });
  registerChatTurn(record);
  try {
    const history = await buildAiHistory({
      sourceMessages: [...historyBefore, question],
      attachmentBlobs: new Map(),
      loadAttachment: env.loadAttachment,
    }).catch(() => []);
    const { notebookGrounding, gemPrompt } = await resolveChatTurnGrounding({
      text: question.content,
      notebookId,
      gemId,
      modelConfig,
      apiKeys,
    });
    await runChatTurn(record, {
      ...buildChatTurnSetup({
        model,
        apiKey: model.apiKey,
        prevMessages: historyBefore,
        tool,
        isIncognito: false,
        chatKey: chatId,
        modelConfig,
        apiKeys,
        notebookGrounding,
        gemPrompt,
        libraryScopeId: env.scopeId() || 'guest',
      }),
      history,
      attachmentPersistence: Promise.resolve(),
      currentScopeId: env.scopeId,
      saveChat: env.saveChat,
    });
  } finally {
    handle.finish();
  }
};

export const registerChatTurnTakeover = (env: ChatTurnTakeoverEnv): (() => void) =>
  registerBackgroundJobKind<ChatTurnJob>(CHAT_TURN_JOB, {
    canTakeOver: (job) => job.scopeId === env.scopeId(),
    takeOver: (job) => resumeChatTurn(job, env),
  });
