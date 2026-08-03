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
    let content = message.content;
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
