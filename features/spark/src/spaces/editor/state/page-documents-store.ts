import { create } from "zustand";
import type { PageActor } from "../../state";
import {
  createPageId,
  emptyParagraph,
  type PageBlock,
  type PageCommentAuthor,
  type PageCommentThread,
  type PageDocument,
  type PageDocumentStatus,
  type PageInline,
  type PageTaskMention,
} from "./page-document";
import { seedPageDocuments } from "./seed-documents";

/** Locates an editable text unit: a text block, or one row of a list block. */
export interface PageUnitRef {
  blockId: string;
  itemId?: string;
}

interface PageDocumentsStore {
  documents: Record<string, PageDocument>;
  ensureDocument: (pageId: string) => PageDocument;
  setDocumentStatus: (pageId: string, status: PageDocumentStatus) => void;
  /** Replaces the whole block list; `actor` records attribution for blocks that changed. */
  setBlocks: (pageId: string, blocks: PageBlock[], actor?: PageActor) => void;
  setUnitContent: (pageId: string, unit: PageUnitRef, content: PageInline[]) => void;
  createThread: (pageId: string, input: { blockId: string | null; quote: string; author: PageCommentAuthor; body: PageInline[]; threadId?: string }) => string;
  replyToThread: (pageId: string, threadId: string, author: PageCommentAuthor, body: PageInline[]) => string;
  editMessage: (pageId: string, threadId: string, messageId: string, body: PageInline[]) => void;
  deleteMessage: (pageId: string, threadId: string, messageId: string) => void;
  deleteThread: (pageId: string, threadId: string) => void;
  setThreadState: (pageId: string, threadId: string, state: PageCommentThread["state"]) => void;
  toggleReaction: (pageId: string, threadId: string, messageId: string, emoji: string, accountUserId: string, active?: boolean) => void;
  addTaskMention: (pageId: string, mention: PageTaskMention) => void;
  updateTaskMention: (pageId: string, mentionId: string, patch: Partial<PageTaskMention>) => void;
  resetDocuments: () => void;
}

function blankDocument(pageId: string): PageDocument {
  return { pageId, status: "ready", blocks: [emptyParagraph()], threads: [], taskMentions: {}, attribution: {} };
}

function patchDocument(documents: Record<string, PageDocument>, pageId: string, update: (document: PageDocument) => PageDocument) {
  const current = documents[pageId] ?? seedPageDocuments()[pageId] ?? blankDocument(pageId);
  return { documents: { ...documents, [pageId]: update(current) } };
}

function patchThread(document: PageDocument, threadId: string, update: (thread: PageCommentThread) => PageCommentThread | null): PageDocument {
  const threads = document.threads.flatMap((thread) => {
    if (thread.id !== threadId) return [thread];
    const next = update(thread);
    return next == null ? [] : [next];
  });
  return { ...document, threads };
}

export const usePageDocumentsStore = create<PageDocumentsStore>((set, get) => ({
  documents: seedPageDocuments(),
  ensureDocument: (pageId) => {
    const existing = get().documents[pageId];
    if (existing != null) return existing;
    const document = blankDocument(pageId);
    set((state) => ({ documents: { ...state.documents, [pageId]: document } }));
    return document;
  },
  setDocumentStatus: (pageId, status) => set((state) => patchDocument(state.documents, pageId, (document) => ({ ...document, status }))),
  setBlocks: (pageId, blocks, actor) =>
    set((state) =>
      patchDocument(state.documents, pageId, (document) => {
        if (actor == null) return { ...document, blocks };
        const previous = new Map(document.blocks.map((block) => [block.id, block]));
        const attribution = { ...document.attribution };
        const changedAt = new Date().toISOString();
        for (const block of blocks) {
          if (previous.get(block.id) !== block) attribution[block.id] = { actor, changedAt };
        }
        return { ...document, blocks, attribution };
      }),
    ),
  setUnitContent: (pageId, unit, content) =>
    set((state) =>
      patchDocument(state.documents, pageId, (document) => ({
        ...document,
        blocks: document.blocks.map((block) => {
          if (block.id !== unit.blockId) return block;
          if (unit.itemId != null && (block.type === "list" || block.type === "ordered_list")) {
            return { ...block, items: block.items.map((item) => (item.id === unit.itemId ? { ...item, content } : item)) };
          }
          return "content" in block ? { ...block, content } : block;
        }),
      })),
    ),
  createThread: (pageId, { blockId, quote, author, body, threadId = createPageId("thread") }) => {
    const now = Date.now();
    const thread: PageCommentThread = {
      id: threadId,
      quote,
      blockId,
      state: "open",
      createdAt: now,
      messages: [{ id: createPageId("message"), author, body, createdAt: now, reactions: [] }],
    };
    set((state) => patchDocument(state.documents, pageId, (document) => ({ ...document, threads: [...document.threads, thread] })));
    return threadId;
  },
  replyToThread: (pageId, threadId, author, body) => {
    const id = createPageId("message");
    set((state) =>
      patchDocument(state.documents, pageId, (document) =>
        patchThread(document, threadId, (thread) => ({ ...thread, messages: [...thread.messages, { id, author, body, createdAt: Date.now(), reactions: [] }] })),
      ),
    );
    return id;
  },
  editMessage: (pageId, threadId, messageId, body) =>
    set((state) =>
      patchDocument(state.documents, pageId, (document) =>
        patchThread(document, threadId, (thread) => ({
          ...thread,
          messages: thread.messages.map((message) => (message.id === messageId ? { ...message, body, editedAt: Date.now() } : message)),
        })),
      ),
    ),
  deleteMessage: (pageId, threadId, messageId) =>
    set((state) =>
      patchDocument(state.documents, pageId, (document) =>
        patchThread(document, threadId, (thread) => {
          const messages = thread.messages.map((message) => (message.id === messageId ? { ...message, body: [], deletedAt: Date.now(), reactions: [] } : message));
          return messages.every((message) => message.deletedAt != null) ? null : { ...thread, messages };
        }),
      ),
    ),
  deleteThread: (pageId, threadId) => set((state) => patchDocument(state.documents, pageId, (document) => patchThread(document, threadId, () => null))),
  setThreadState: (pageId, threadId, threadState) =>
    set((state) =>
      patchDocument(state.documents, pageId, (document) =>
        patchThread(document, threadId, (thread) => ({ ...thread, state: threadState, resolvedAt: threadState === "resolved" ? Date.now() : undefined })),
      ),
    ),
  toggleReaction: (pageId, threadId, messageId, emoji, accountUserId, active) =>
    set((state) =>
      patchDocument(state.documents, pageId, (document) =>
        patchThread(document, threadId, (thread) => ({
          ...thread,
          messages: thread.messages.map((message) => {
            if (message.id !== messageId) return message;
            const existing = message.reactions.find((reaction) => reaction.emoji === emoji);
            const reacted = existing?.reactorIds.includes(accountUserId) ?? false;
            const shouldReact = active ?? !reacted;
            if (shouldReact === reacted) return message;
            const reactorIds = shouldReact ? [...(existing?.reactorIds ?? []), accountUserId] : (existing?.reactorIds ?? []).filter((id) => id !== accountUserId);
            const others = message.reactions.filter((reaction) => reaction.emoji !== emoji);
            return { ...message, reactions: reactorIds.length === 0 ? others : [...others, { emoji, reactorIds }] };
          }),
        })),
      ),
    ),
  addTaskMention: (pageId, mention) =>
    set((state) => patchDocument(state.documents, pageId, (document) => ({ ...document, taskMentions: { ...document.taskMentions, [mention.id]: mention } }))),
  updateTaskMention: (pageId, mentionId, patch) =>
    set((state) =>
      patchDocument(state.documents, pageId, (document) => {
        const mention = document.taskMentions[mentionId];
        return mention == null ? document : { ...document, taskMentions: { ...document.taskMentions, [mentionId]: { ...mention, ...patch } } };
      }),
    ),
  resetDocuments: () => set({ documents: seedPageDocuments() }),
}));

export function usePageDocument(pageId: string) {
  return usePageDocumentsStore((state) => state.documents[pageId]);
}
