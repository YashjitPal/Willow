/**
 * The image a follow-up like "make it cuter" means: the newest in the thread, whether a reply
 * made it or the user sent it. Gemini edits that one when a request asks to change "it"; the
 * chat model says so with `use_previous_image`, and the host hands this to the generator.
 */
import type { ChatAttachment } from '@willow/core/attachments';
import type { ChatMsg } from '../chat-message';

const imagesIn = (message: ChatMsg): ChatAttachment[] => (message.role === 'assistant'
  ? (message.media ?? [])
    .filter((item) => item.kind === 'image' && item.status === 'done' && item.attachment)
    .map((item) => item.attachment!)
  : (message.attachments ?? []).filter((attachment) => attachment.kind === 'image'));

export const newestThreadImage = (messages: readonly ChatMsg[]): ChatAttachment | null => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const images = imagesIn(messages[i]!);
    if (images.length) return images[images.length - 1]!;
  }
  return null;
};

/** An image already in the thread, sent again: what the image card's Edit attaches. */
export const isThreadImage = (messages: readonly ChatMsg[], id: string): boolean =>
  messages.some((message) => imagesIn(message).some((image) => image.id === id));
