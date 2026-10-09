/**
 * A Code chat's files, kept beside it on disk rather than inside it.
 *
 * Code messages carry an attachment's bytes inline (`data`), and an annotated preview
 * screenshot as a `data:` URL on its step. Saved as `Chat sessions/<chat>.json`, all of
 * that was base64 in the middle of the JSON. Each one is now a file in the chat's
 * folder beside it — `Attachments/` for what the user attached, `Screenshots/` for what
 * the agent captured — and the JSON names the file it is in.
 *
 * `keepInline` is for a chat that is read back from its JSON (a Code chat before its
 * project exists lives in `Chats/`, and reopening it reads the bytes from there): it
 * keeps the bytes and gains the files and their names. A project's `Chat sessions/` is
 * only ever written, so its JSON drops the bytes for the name.
 */
import { base64ToBlob } from '@willow/core/attachments';
import {
  CONVERSATION_FOLDERS,
  contentKey,
  conversationFileName,
  type ConversationFile,
} from '@willow/storage/local-fs/conversation-files';

interface InlineAttachment {
  type?: string;
  mimeType?: string;
  data?: string;
  name?: string;
}

const attachmentBlob = (attachment: InlineAttachment): Blob => {
  const mimeType = attachment.mimeType || 'application/octet-stream';
  // Text attachments hold their text; everything else is base64.
  return attachment.type === 'text'
    ? new Blob([attachment.data ?? ''], { type: mimeType })
    : base64ToBlob(attachment.data ?? '', mimeType);
};

export const splitChatFiles = <T,>(messages: readonly T[], { keepInline }: { keepInline: boolean }): { messages: T[]; files: ConversationFile[] } => {
  const files = new Map<string, ConversationFile>();
  const keep = (path: string, read: () => Blob) => {
    if (!files.has(path)) files.set(path, { path, read });
  };

  const split = messages.map((message: any) => {
    let next = message;
    if (Array.isArray(message?.attachments) && message.attachments.length) {
      next = {
        ...next,
        attachments: message.attachments.map((attachment: InlineAttachment) => {
          if (!attachment || typeof attachment.data !== 'string' || !attachment.data) return attachment;
          const path = `${CONVERSATION_FOLDERS.attachments}/${conversationFileName(attachment.name, contentKey(attachment.data), attachment.mimeType)}`;
          keep(path, () => attachmentBlob(attachment));
          if (keepInline) return { ...attachment, file: path };
          const { data: _data, ...rest } = attachment;
          return { ...rest, file: path };
        }),
      };
    }
    if (Array.isArray(message?.steps) && message.steps.length) {
      next = {
        ...next,
        steps: message.steps.map((step: any) => {
          if (step?.kind !== 'image' || typeof step.src !== 'string' || !step.src.startsWith('data:image/')) return step;
          const mimeType = /^data:([^;,]+)/.exec(step.src)?.[1] || 'image/png';
          const path = `${CONVERSATION_FOLDERS.screenshots}/${conversationFileName('Screenshot', contentKey(step.src), mimeType)}`;
          const src = step.src as string;
          keep(path, () => base64ToBlob(src, mimeType));
          if (keepInline) return { ...step, file: path };
          const { src: _src, ...rest } = step;
          return { ...rest, file: path };
        }),
      };
    }
    return next as T;
  });

  return { messages: split, files: [...files.values()] };
};
