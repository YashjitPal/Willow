// The chat thread's message shape, plus the pure helpers that decide what a
// saved chat file contains. Split out of `ChatView.tsx` — none of this reads
// component state, and `serializeChatMessage`/`sanitizeSavedAttachment` are the
// two halves of the in-memory ⇄ on-disk contract, which is easier to keep
// honest when the pair sits together and alone.

import {
  ChatAttachment,
  detectAttachmentKind,
  toPersistedChatAttachment,
} from '@willow/core/attachments';

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinkingTime?: number;
  /** Displayable thought summary returned by the model, never hidden chain-of-thought data. */
  thinkingText?: string;
  modelSnapshot?: {
    provider: string;
    modelId: string;
    label: string;
    thinkingLevel: number;
  };
  isError?: boolean;
  isGenerating?: boolean;
  /** User bubble is a live-voice utterance whose transcript hasn't arrived yet. */
  isTranscribing?: boolean;
  /** Assistant turn driven by the Live API (no Thinking row). */
  isLive?: boolean;
  /** Live reply cut short by user barge-in — rendered without the action row. */
  wasInterrupted?: boolean;
  /** Typed reply the user stopped from the composer. Persisted, because Gemini
   *  keeps the "You stopped this response" notice on reload. */
  wasStopped?: boolean;
  /** Whether this message was newly sent in the current session (should animate in). */
  isNew?: boolean;
  /** Locally owned file metadata; bytes live in WillowDB's attachment store. */
  attachments?: ChatAttachment[];
}

/** A message is worth persisting if it has text or at least one attachment. */
export const hasSavedMessageContent = (message: Pick<ChatMsg, 'content' | 'attachments'>): boolean =>
  message.content.trim().length > 0 || !!message.attachments?.length;

/** Strip the runtime-only flags so a reloaded chat never resumes mid-generation. */
export const serializeChatMessage = (message: ChatMsg): Omit<ChatMsg, 'isGenerating' | 'isTranscribing' | 'isLive' | 'isNew'> => {
  const {
    isGenerating: _isGenerating,
    isTranscribing: _isTranscribing,
    isLive: _isLive,
    isNew: _isNew,
    attachments,
    ...persisted
  } = message;
  return {
    ...persisted,
    ...(attachments?.length
      ? { attachments: attachments.map(toPersistedChatAttachment) }
      : {}),
  };
};

/**
 * Read one attachment back off disk. Everything is re-checked because the file
 * is user-editable and may predate any field added since it was written.
 */
export const sanitizeSavedAttachment = (value: any): ChatAttachment | null => {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string') return null;
  const name = typeof value.name === 'string' && value.name.trim() ? value.name : 'Attachment';
  const mimeType = typeof value.mimeType === 'string' && value.mimeType.trim()
    ? value.mimeType
    : 'application/octet-stream';
  const extension = typeof value.extension === 'string'
    ? value.extension.replace(/^\./, '').toLowerCase()
    : (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');
  return {
    id: value.id,
    name,
    mimeType,
    extension,
    size: Number.isFinite(value.size) ? Math.max(0, Number(value.size)) : 0,
    kind: typeof value.kind === 'string'
      ? value.kind
      : detectAttachmentKind(name, mimeType),
    sourceUrl: typeof value.sourceUrl === 'string' ? value.sourceUrl : undefined,
    sourceOwner: typeof value.sourceOwner === 'string' ? value.sourceOwner : undefined,
    sourceRepository: typeof value.sourceRepository === 'string' ? value.sourceRepository : undefined,
    sourceRef: typeof value.sourceRef === 'string' ? value.sourceRef : undefined,
    sourceCommit: typeof value.sourceCommit === 'string' ? value.sourceCommit : undefined,
    sourceDescription: typeof value.sourceDescription === 'string' ? value.sourceDescription : undefined,
    sourceFileCount: Number.isFinite(value.sourceFileCount)
      ? Math.max(0, Number(value.sourceFileCount))
      : undefined,
  } as ChatAttachment;
};
