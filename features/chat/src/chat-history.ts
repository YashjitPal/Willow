import { ChatMessage as AiChatMessage } from '@willow/ai/chat';
import { blobToBase64, isTextLikeAttachment } from '@willow/core/attachments';
import type { StoredChatAttachment } from '@willow/storage/indexeddb/willow-db';
import { ChatMsg } from './chat-message';

export interface BuildAiHistoryInput {
  /** Conversation turns to convert, oldest first. */
  sourceMessages: ChatMsg[];
  /** In-memory blob cache, read first and populated on every successful load. */
  attachmentBlobs: Map<string, Blob>;
  /** Fallback lookup for attachments that are not in the cache. */
  loadAttachment: (attachmentId: string) => Promise<StoredChatAttachment | null>;
}

/**
 * A Deep Research plan or report lives on the message, not in its text ("I've completed your
 * research…"), so the model is shown it here — or "change the plan" and "make a quiz from
 * this" would have nothing to refer to.
 */
const researchContext = (message: ChatMsg): string => {
  const research = message.role === 'assistant' ? message.research : undefined;
  if (!research) return '';
  if (research.status === 'plan') {
    return `\n\n[Deep Research plan "${research.title}":\n${research.steps.map((step, i) => `(${i + 1}) ${step}`).join('\n')}]`;
  }
  if (research.status === 'done' && research.report) return `\n\n[Deep Research report "${research.title}"]\n${research.report}`;
  return '';
};

const MEDIA_NOUN = { image: 'an image', video: 'a video', music: 'a music track' } as const;

/**
 * What a reply's media tools made sits on the message, not in its text (often there is none),
 * so the model is told here — or "make it cuter" would have no "it", and an edit's prompt
 * could not describe the whole new picture.
 */
export const mediaContext = (message: ChatMsg): string => {
  if (message.role !== 'assistant' || !message.media?.length) return '';
  return message.media.map((item) => {
    const what = `${MEDIA_NOUN[item.kind]}${item.kind === 'music' && item.title ? ` titled "${item.title}"` : ''}`;
    return item.status === 'done'
      ? `\n\n[You made ${what} here, from the prompt: ${item.prompt}]`
      : `\n\n[${what[0]!.toUpperCase()}${what.slice(1)} you started here did not finish.]`;
  }).join('');
};

/**
 * Converts stored chat messages into the wire format the AI client expects,
 * inlining each attachment's bytes as text, base64, or a file reference.
 *
 * Attachments whose blob cannot be recovered on this device are not dropped
 * silently: a note is appended to the message content so the model still sees
 * that something was attached.
 */
export const buildAiHistory = async ({
  sourceMessages,
  attachmentBlobs,
  loadAttachment,
}: BuildAiHistoryInput): Promise<AiChatMessage[]> => {
  return await Promise.all(sourceMessages.map(async (message) => {
    let content = message.content + researchContext(message) + mediaContext(message);
    if (!message.attachments?.length) return { role: message.role, content };

    const aiAttachments: NonNullable<AiChatMessage['attachments']> = [];
    for (const attachment of message.attachments) {
      let blob = attachmentBlobs.get(attachment.id);
      if (!blob) {
        const stored = await loadAttachment(attachment.id);
        blob = stored?.blob;
        if (blob) attachmentBlobs.set(attachment.id, blob);
      }

      if (!blob) {
        if (attachment.kind === 'github' && attachment.sourceUrl) {
          content += `\n\n[GitHub repository source: ${attachment.name} (${attachment.sourceUrl})]`;
        } else {
          content += `\n\n[Attachment unavailable on this device: ${attachment.name}]`;
        }
        continue;
      }

      if (attachment.kind === 'github') {
        aiAttachments.push({
          type: 'text',
          mimeType: 'text/plain',
          data: await blob.text(),
          name: `GitHub repository ${attachment.name}${attachment.sourceRef ? ` at ${attachment.sourceRef}` : ''}`,
          size: attachment.size,
        });
        continue;
      }

      const textLike = isTextLikeAttachment(attachment);
      aiAttachments.push({
        type: attachment.kind === 'image' ? 'image' : textLike ? 'text' : 'file',
        mimeType: attachment.mimeType,
        data: textLike ? await blob.text() : await blobToBase64(blob),
        name: attachment.name,
        size: attachment.size,
      });
    }

    return {
      role: message.role,
      content,
      ...(aiAttachments.length ? { attachments: aiAttachments } : {}),
    };
  }));
};
