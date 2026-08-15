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
import type { CodeExecution } from '@willow/ai/code-execution';

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
  /** Raw provider detail kept in memory for the opt-in error dialog only. */
  errorDetail?: string;
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
  /** Code the model ran and what it printed, indexed against `content` like
   *  citations are, driving the "Show code" panels. */
  codeExecutions?: CodeExecution[];
}

/**
 * A message is worth persisting if it has text or at least one attachment.
 *
 * A stopped turn counts even when it is empty. Pressing stop before the first
 * token leaves no text, but the turn still renders — the "You stopped this
 * response" notice IS its content, and Gemini keeps such a turn in the thread.
 * Without this the whole turn was dropped on save, so the user's question came
 * back from disk with no response under it at all.
 *
 * A code-execution panel counts for exactly the same reason: a model that runs
 * code and answers entirely through its output leaves `content` empty, and the
 * panel is then the only thing the turn has to show.
 */
export const hasSavedMessageContent = (
  message: Pick<ChatMsg, 'content' | 'attachments' | 'wasStopped' | 'codeExecutions'>,
): boolean =>
  message.content.trim().length > 0
  || !!message.attachments?.length
  || !!message.wasStopped
  || !!message.codeExecutions?.length;

/** Strip the runtime-only flags so a reloaded chat never resumes mid-generation. */
export const serializeChatMessage = (message: ChatMsg): Omit<ChatMsg, 'isGenerating' | 'isTranscribing' | 'isLive' | 'isNew' | 'errorDetail'> => {
  const {
    isGenerating: _isGenerating,
    isTranscribing: _isTranscribing,
    isLive: _isLive,
    isNew: _isNew,
    errorDetail: _errorDetail,
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
 *
 * Sources are kept even when no citation survives, because for some providers a
 * bare source list is all there ever was: xAI returns a flat array of URLs and
 * Zhipu a `web_search` array, neither with character offsets. Those turns render
 * the sources panel and no inline chips, which is the same way an ungrounded
 * Gemini turn already behaves. Requiring both arrays here would have thrown that
 * away on the next load, so the turn would show sources until it was reopened.
 */
export const sanitizeSavedCitations = (value: any): MessageCitations | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const rawSources = Array.isArray(value.sources) ? value.sources : [];
  const rawCitations = Array.isArray(value.citations) ? value.citations : [];
  if (!rawSources.length) return undefined;

  const sources = rawSources.map((source: any) => {
    const source_: any = {
      uri: typeof source?.uri === 'string' ? source.uri : '',
      title: typeof source?.title === 'string' ? source.title : '',
      domain: typeof source?.domain === 'string' ? source.domain : '',
    };
    // The snippet is the second line of the card, so dropping it here used to
    // make a reloaded turn's sources visibly plainer than the live ones.
    if (typeof source?.snippet === 'string' && source.snippet) source_.snippet = source.snippet;
    return source_;
  });

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

  return sources.length ? { sources, citations } : undefined;
};

/**
 * Read code-execution panels back off disk.
 *
 * Re-checked field by field for the same reason citations are: the chat file is
 * user-editable and predates this field. A block with no `code` is dropped —
 * there is nothing to show — but a block with a bad `position` is *kept* and its
 * offset repaired rather than discarded. That is the opposite call to
 * `sanitizeSavedCitations`, deliberately: a mis-anchored citation chip points at
 * the wrong sentence and is worse than none, whereas a mis-anchored panel still
 * shows the right code and only sits in the wrong place in the turn. Dropping it
 * would lose the code the model ran, which is the actual content here.
 *
 * `contentLength` clamps offsets against the text they index into, so a
 * truncated `content` cannot push a panel past the end of the turn.
 */
export const sanitizeSavedCodeExecutions = (
  value: any,
  contentLength = Number.MAX_SAFE_INTEGER,
): CodeExecution[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const executions = value
    .filter((entry: any) => entry && typeof entry === 'object' && typeof entry.code === 'string' && entry.code.length > 0)
    .map((entry: any) => {
      const execution: CodeExecution = {
        language: typeof entry.language === 'string' ? entry.language : '',
        code: entry.code,
        position: Number.isFinite(entry.position)
          ? Math.min(Math.max(0, Math.floor(Number(entry.position))), contentLength)
          : 0,
      };
      // Absent and empty are different states: absent means the sandbox never
      // reported back, which is what the panel renders as still-running. A
      // reloaded turn is never still running, so an absent output is left absent
      // and the panel simply omits the output section.
      if (typeof entry.output === 'string') execution.output = entry.output;
      if (typeof entry.outcome === 'string' && entry.outcome) execution.outcome = entry.outcome;
      return execution;
    });
  return executions.length ? executions : undefined;
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
