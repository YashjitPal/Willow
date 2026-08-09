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
import type { MessageCitations } from '@willow/ai/grounding';

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
  /** Grounded web sources, indexed against `content`, driving the inline chips. */
  citations?: MessageCitations;
}

/**
 * A message is worth persisting if it has text or at least one attachment.
 *
 * A stopped turn counts even when it is empty. Pressing stop before the first
 * token leaves no text, but the turn still renders — the "You stopped this
 * response" notice IS its content, and Gemini keeps such a turn in the thread.
 * Without this the whole turn was dropped on save, so the user's question came
 * back from disk with no response under it at all.
 */
export const hasSavedMessageContent = (
  message: Pick<ChatMsg, 'content' | 'attachments' | 'wasStopped'>,
): boolean =>
  message.content.trim().length > 0 || !!message.attachments?.length || !!message.wasStopped;

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
 * Read grounded citations back off disk.
 *
 * Every field is re-checked for the same reason attachments are: the chat file
 * is user-editable and may predate the field. A malformed entry is dropped
 * rather than repaired — a chip pointing at the wrong sentence is worse than no
 * chip. Source indices are validated against the array they index into, so a
 * truncated `sources` list cannot produce an undefined chip label.
 */
export const sanitizeSavedCitations = (value: any): MessageCitations | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const rawSources = Array.isArray(value.sources) ? value.sources : [];
  const rawCitations = Array.isArray(value.citations) ? value.citations : [];
  if (!rawSources.length || !rawCitations.length) return undefined;

  const sources = rawSources.map((source: any) => ({
    uri: typeof source?.uri === 'string' ? source.uri : '',
    title: typeof source?.title === 'string' ? source.title : '',
    domain: typeof source?.domain === 'string' ? source.domain : '',
  }));

  const citations = rawCitations
    .filter((citation: any) =>
      citation
      && Number.isFinite(citation.startIndex)
      && Number.isFinite(citation.endIndex)
      && citation.endIndex > citation.startIndex
      && Array.isArray(citation.sourceIndices))
    .map((citation: any) => ({
      startIndex: Number(citation.startIndex),
      endIndex: Number(citation.endIndex),
      sourceIndices: citation.sourceIndices.filter(
        (index: unknown) => Number.isInteger(index) && (index as number) >= 0 && (index as number) < sources.length,
      ),
    }))
    .filter((citation: any) => citation.sourceIndices.length > 0);

  return citations.length ? { sources, citations } : undefined;
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
