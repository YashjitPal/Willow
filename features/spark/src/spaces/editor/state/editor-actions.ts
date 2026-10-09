import { placeholderReplyText, placeholderThinkingMs } from "../../willow/dot/state/placeholder-reply";
import { selfUserId } from "../../willow/dot/state/room-store";
import type { PageActor } from "../../state";
import { findUnit, insertAfter, unitContent, withUnitContent } from "../document-model";
import { removeThread, setThreadOnRange } from "../inline-dom";
import { createPageId, text, type PageBlock, type PageInline } from "./page-document";
import { usePageDocumentsStore } from "./page-documents-store";
import { usePageEditorUiStore } from "./page-editor-ui-store";

export const selfActor: PageActor = { actor_type: "user", account_user_id: selfUserId };
/** One of the signed-in person's bots (`agent_kind: "o"`), acting for them. */
export const dotActor = (dotId: string): PageActor => ({ actor_type: "agent", agent_kind: "o", account_user_id: selfUserId, dot_id: dotId });
/** Willow's generation started by the signed-in person. */
export const chatgptActor: PageActor = { actor_type: "agent", agent_kind: null, account_user_id: selfUserId };

/** Selected text a new comment thread will anchor on. */
export interface CommentTarget {
  blockId: string;
  unitKey: string;
  from: number;
  to: number;
  quote: string;
}

function documentBlocks(pageId: string) {
  return usePageDocumentsStore.getState().documents[pageId]?.blocks;
}

function placeBlocks(blocks: PageBlock[], afterBlockId: string | null, inserted: PageBlock[]) {
  return afterBlockId == null || !blocks.some((block) => block.id === afterBlockId) ? [...blocks, ...inserted] : insertAfter(blocks, afterBlockId, inserted);
}

/** Inserts blocks below `afterBlockId` (or at the end) on behalf of `actor`. */
export function insertBlocks(pageId: string, afterBlockId: string | null, inserted: PageBlock[], actor: PageActor) {
  const blocks = documentBlocks(pageId);
  if (blocks == null) return;
  usePageDocumentsStore.getState().setBlocks(pageId, placeBlocks(blocks, afterBlockId, inserted), actor);
}

/** "Generate" / "Use your prompt": placeholder text written by ChatGPT after a short delay. */
export function generateText(pageId: string, afterBlockId: string | null) {
  const ui = usePageEditorUiStore.getState();
  ui.setGenerating(true);
  window.setTimeout(() => {
    insertBlocks(pageId, afterBlockId, [{ id: createPageId("block"), type: "paragraph", content: [text(placeholderReplyText)] }], chatgptActor);
    usePageEditorUiStore.getState().setGenerating(false);
  }, placeholderThinkingMs);
}

/** "Visualize": a `page_visualization` block that finishes generating after a short delay. */
export function generateVisualization(pageId: string, afterBlockId: string | null, title: string, prompt?: string) {
  const id = createPageId("block");
  const fileId = `page-asset:${createPageId("visualization")}`;
  usePageEditorUiStore.getState().setGenerating(true);
  insertBlocks(pageId, afterBlockId, [{ id, type: "page_visualization", fileId, title, status: "generating", prompt }], chatgptActor);
  window.setTimeout(() => {
    const blocks = documentBlocks(pageId);
    usePageEditorUiStore.getState().setGenerating(false);
    if (blocks == null) return;
    const next = blocks.map((block) => (block.id === id && block.type === "page_visualization" ? { ...block, status: "ready" as const } : block));
    usePageDocumentsStore.getState().setBlocks(pageId, next, chatgptActor);
  }, placeholderThinkingMs);
}

/** Marks the target text with the thread's `page-comment-highlight` anchor. */
export function anchorCommentThread(pageId: string, target: CommentTarget, threadId: string) {
  const blocks = documentBlocks(pageId);
  const unit = blocks == null ? undefined : findUnit(blocks, target.unitKey);
  if (blocks == null || unit == null || unit.kind !== "inline") return;
  const content = setThreadOnRange(unitContent(blocks, unit), target.from, target.to, threadId);
  usePageDocumentsStore.getState().setBlocks(pageId, withUnitContent(blocks, unit, content));
}

/** Removes a deleted thread's anchors from every unit. */
export function clearCommentAnchors(pageId: string, threadId: string) {
  const blocks = documentBlocks(pageId);
  if (blocks == null) return;
  const strip = (content: PageInline[]) => removeThread(content, threadId);
  const next = blocks.map((block): PageBlock => {
    if ("content" in block) return { ...block, content: strip(block.content) };
    if (block.type === "list" || block.type === "ordered_list") return { ...block, items: block.items.map((item) => ({ ...item, content: strip(item.content) })) };
    return block;
  });
  usePageDocumentsStore.getState().setBlocks(pageId, next);
}

/** The block holding a task mention atom. */
export function findMentionBlock(blocks: PageBlock[], mentionId: string) {
  const holds = (content: PageInline[]) => content.some((run) => run.kind === "taskMention" && run.mentionId === mentionId);
  return blocks.find((block) => ("content" in block ? holds(block.content) : (block.type === "list" || block.type === "ordered_list") && block.items.some((item) => holds(item.content))));
}
