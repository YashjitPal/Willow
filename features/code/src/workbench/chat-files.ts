/**
 * A Code chat's files, kept beside it on disk rather than inside it.
 *
 * Code messages carry an attachment's bytes inline (`data`), and an annotated preview
 * screenshot as a `data:` URL on its step. Saved as `Chat sessions/<chat>.json`, all of
 * that was base64 in the middle of the JSON. Each one is now a file in the chat's
 * folder beside it — `Attachments/` for what the user attached, `Screenshots/` for what
 * the agent captured — and the JSON names the file it is in.
 *
 * `keepInline` is for a chat that is read back from its JSON on every reopen (a Code
 * chat before its project exists lives in `Chats/`, and reopening it reads the bytes
 * from there): it keeps the bytes and gains the files and their names. A project's
 * `Chat sessions/` JSON drops the bytes for the name, because it is read back only
 * when browser storage has none of the project's chats (./restore-project-chats). Then
 * `joinChatFiles` reads each file the JSON names and puts its bytes back inline, so
 * the chat holds what it held before it was saved.
 */
import { base64ToBlob, blobToBase64 } from '@willow/core/attachments';
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

// A screenshot's name took its extension from the `data:` URL's type, and its hash
// from the whole URL, so the URL rebuilt from it must match to the byte: a save of
// the restored chat then names the same file instead of writing a second one.
const IMAGE_TYPE_BY_EXTENSION: Record<string, string> = { jpg: 'image/jpeg', svg: 'image/svg+xml' };

const screenshotType = (path: string, blob: Blob): string => {
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  if (extension) return IMAGE_TYPE_BY_EXTENSION[extension] ?? `image/${extension}`;
  return blob.type || 'image/png';
};

/**
 * The reverse of `splitChatFiles`: each file a message names is read back into the
 * message, as `data` on an attachment and a `data:` URL on a screenshot step. One
 * already holding its bytes is left alone, and one whose file cannot be read keeps
 * its name without them.
 */
export const joinChatFiles = async <T,>(messages: readonly T[], read: (path: string) => Promise<Blob | null>): Promise<T[]> => {
  const reads = new Map<string, Promise<Blob | null>>();
  const readOnce = (path: string): Promise<Blob | null> => {
    let blob = reads.get(path);
    if (!blob) {
      blob = read(path).catch(() => null);
      reads.set(path, blob);
    }
    return blob;
  };

  const joined: T[] = [];
  for (const message of messages as any[]) {
    let next = message;
    if (Array.isArray(message?.attachments) && message.attachments.length) {
      next = {
        ...next,
        attachments: await Promise.all(message.attachments.map(async (attachment: InlineAttachment & { file?: unknown }) => {
          if (!attachment || typeof attachment.file !== 'string' || (typeof attachment.data === 'string' && attachment.data)) return attachment;
          const blob = await readOnce(attachment.file);
          if (!blob) return attachment;
          const data = attachment.type === 'text' ? await blob.text() : await blobToBase64(blob);
          return { ...attachment, data };
        })),
      };
    }
    if (Array.isArray(message?.steps) && message.steps.length) {
      next = {
        ...next,
        steps: await Promise.all(message.steps.map(async (step: any) => {
          if (step?.kind !== 'image' || typeof step.file !== 'string' || (typeof step.src === 'string' && step.src)) return step;
          const blob = await readOnce(step.file);
          if (!blob) return step;
          return { ...step, src: `data:${screenshotType(step.file, blob)};base64,${await blobToBase64(blob)}` };
        })),
      };
    }
    joined.push(next as T);
  }
  return joined;
};
