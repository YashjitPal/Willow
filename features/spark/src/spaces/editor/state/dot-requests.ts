import type { IntlShape } from "react-intl";
import { placeholderReplyText, placeholderThinkingMs } from "../../willow/dot/state/placeholder-reply";
import { selfUserId, useRoomStore } from "../../willow/dot/state/room-store";
import { pageShareUrl } from "../../navigation";
import { addDotToPage } from "../../state/dot-access";
import { mentionMessages } from "../messages";
import { dotActor, findMentionBlock, insertBlocks } from "./editor-actions";
import { blockPlainText, createPageId, text, type PageCommentAuthor, type PageInline } from "./page-document";
import { usePageDocumentsStore } from "./page-documents-store";

/** Delay before a failed send is reported, matching the room store's delivery round trip. */
const deliveryMs = 450;

const selfAuthor: PageCommentAuthor = { kind: "user", accountUserId: selfUserId };

/** The visible part of the request a bot receives in its own thread: `orbitRequestSource` then the user's text. */
export function orbitRequestText(intl: IntlShape, pageId: string, userText: string) {
  return `${intl.formatMessage(mentionMessages.orbitRequestSource, { pageUrl: pageShareUrl(pageId) })}\n\n${userText}`;
}

function documentOf(pageId: string) {
  return usePageDocumentsStore.getState().documents[pageId];
}

/**
 * Sends a composed task mention: a Willow task, or (with `orbit`) a request to one of your bots, which joins the Page.
 * Page mentions open a comment thread holding the request; comment mentions reuse the posted message.
 * The bot acknowledges with 👍, replies in the thread and writes a placeholder block into the Page.
 */
export function sendTaskMention(intl: IntlShape, pageId: string, mentionId: string, prompt: string, request?: { threadId: string; messageId: string }) {
  const store = usePageDocumentsStore.getState();
  const document = documentOf(pageId);
  const mention = document?.taskMentions[mentionId];
  if (document == null || mention == null) return;
  let threadId = request?.threadId ?? mention.commentThreadId;
  if (threadId == null) {
    const block = findMentionBlock(document.blocks, mentionId);
    const body: PageInline[] = [{ kind: "taskMention", mentionId }, text(` ${prompt}`)];
    threadId = store.createThread(pageId, { blockId: block?.id ?? null, quote: block == null ? "" : blockPlainText(block), author: selfAuthor, body });
  }
  const thread = documentOf(pageId)?.threads.find((entry) => entry.id === threadId);
  const messageId = request?.messageId ?? thread?.messages[0]?.id;
  store.updateTaskMention(pageId, mentionId, { prompt, status: "pending", commentThreadId: threadId });
  if (thread == null || messageId == null) return;
  const resultAnchor = () => {
    const blocks = documentOf(pageId)?.blocks ?? [];
    return findMentionBlock(blocks, mentionId)?.id ?? thread.blockId;
  };

  if (mention.orbit == null) {
    window.setTimeout(() => {
      const current = usePageDocumentsStore.getState();
      current.updateTaskMention(pageId, mentionId, { status: "started", threadId: createPageId("task") });
      current.replyToThread(pageId, thread.id, { kind: "chatgpt", accountUserId: mention.owner }, [text(placeholderReplyText)]);
    }, placeholderThinkingMs);
    return;
  }

  const conversationId = mention.orbit.threadId;
  const room = useRoomStore.getState();
  if (room.sendOutcome === "failed") {
    window.setTimeout(() => usePageDocumentsStore.getState().updateTaskMention(pageId, mentionId, { status: "failed" }), deliveryMs);
    return;
  }
  room.send(conversationId, orbitRequestText(intl, pageId, prompt));
  addDotToPage(pageId, conversationId);
  window.setTimeout(() => {
    const current = usePageDocumentsStore.getState();
    current.toggleReaction(pageId, thread.id, messageId, "👍", conversationId, true);
    current.updateTaskMention(pageId, mentionId, { status: "started" });
  }, placeholderThinkingMs);
  window.setTimeout(() => {
    usePageDocumentsStore.getState().replyToThread(pageId, thread.id, { kind: "dot", accountUserId: mention.owner, conversationId }, [text(placeholderReplyText)]);
    insertBlocks(pageId, resultAnchor(), [{ id: createPageId("block"), type: "paragraph", content: [text(placeholderReplyText)] }], dotActor(conversationId));
  }, placeholderThinkingMs * 2);
}

/** Starts every task mention a just-posted comment carries; the rest of the comment is the request. */
export function sendCommentMentions(intl: IntlShape, pageId: string, threadId: string, messageId: string, body: PageInline[]) {
  const prompt = body
    .filter((run) => run.kind !== "taskMention")
    .map((run) => (run.kind === "text" ? run.text : run.title))
    .join("")
    .trim();
  for (const run of body) {
    if (run.kind !== "taskMention") continue;
    const mention = documentOf(pageId)?.taskMentions[run.mentionId];
    if (mention == null || mention.status !== "composing") continue;
    sendTaskMention(intl, pageId, run.mentionId, prompt, { threadId, messageId });
  }
}
