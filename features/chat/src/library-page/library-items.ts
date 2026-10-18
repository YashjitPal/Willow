/**
 * What Gemini's Library lists, read out of Willow's saved chats.
 *
 * Gemini's Library (`/library`, a React island in its app) asks its server for the account's
 * artifacts: documents (canvases, Deep Research, generated files) and media (images, videos,
 * music, audio, GIFs, mini apps), newest first. Willow keeps the same things on the messages of
 * each chat — `canvasRefs`, `research` and `media` — so the Library is a fold over the chats.
 * Captures and the island's source: tools/ui-research/captures/gemini/library/.
 */
import type { ChatAttachment } from '@willow/core/attachments';

export type LibraryDocumentKind = 'code' | 'text' | 'research';
export type LibraryMediaKind = 'image' | 'video' | 'music';

export interface LibraryDocument {
  /** Unique across the Library: `chatId` and the document within it. */
  key: string;
  chatId: string;
  kind: LibraryDocumentKind;
  title: string;
  /** When it was last written, for the row's date and the order. */
  updatedAt: number;
  /** The canvas document, for `code` and `text`. */
  docId?: string;
  /** The message that last wrote it (a Deep Research report's own message). */
  messageId: string;
}

export interface LibraryMedia {
  key: string;
  chatId: string;
  messageId: string;
  mediaId: string;
  kind: LibraryMediaKind;
  /** A track's name; images and videos have none, so they read "Untitled" as Gemini's do. */
  title: string;
  prompt: string;
  createdAt: number;
  /** The generated file. */
  file: ChatAttachment;
  /** What the tile shows: the image itself, a track's cover art, or the video's own first frame. */
  thumbnail?: ChatAttachment;
}

export interface ChatLibraryItems {
  documents: LibraryDocument[];
  media: LibraryMedia[];
}

/** How many documents the overview shows; a fourth is what puts up "View all". */
export const DOCUMENTS_PREVIEW = 3;
/** Gemini's page size for media and for the documents list. */
export const LIBRARY_PAGE_SIZE = 30;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number => (Number.isFinite(value) && Number(value) > 0 ? Number(value) : 0);

const asAttachment = (value: unknown): ChatAttachment | undefined => {
  const a = value as ChatAttachment | null;
  return a && typeof a === 'object' && typeof a.id === 'string' && a.id && typeof a.name === 'string' ? a : undefined;
};

/**
 * One chat's Library items, from its saved messages (the on-disk shape).
 *
 * A canvas is one document however many turns rewrote it: the last ref names it and dates it.
 * A Deep Research run is a document once its report exists. Media counts once it is done.
 * `fallbackTime` dates anything written before the timestamps existed (the chat's own time).
 */
export const libraryItemsFromChat = (chatId: string, messages: readonly unknown[], fallbackTime = 0): ChatLibraryItems => {
  const canvases = new Map<string, LibraryDocument>();
  const documents: LibraryDocument[] = [];
  const media: LibraryMedia[] = [];
  for (const raw of messages) {
    const message = raw as Record<string, unknown> | null;
    if (!message || typeof message !== 'object' || message.role !== 'assistant') continue;
    const messageId = str(message.id);
    if (!messageId) continue;

    for (const refRaw of Array.isArray(message.canvasRefs) ? message.canvasRefs : []) {
      const ref = refRaw as Record<string, unknown> | null;
      if (!ref || typeof ref !== 'object' || !str(ref.docId) || !str(ref.content)) continue;
      const docId = str(ref.docId);
      const kind: LibraryDocumentKind = ref.kind === 'code' ? 'code' : 'text';
      const written = Math.max(num(ref.createdAt), num(ref.editedAt));
      const previous = canvases.get(docId);
      canvases.set(docId, {
        key: `${chatId}\u0000canvas\u0000${docId}`,
        chatId,
        kind,
        title: str(ref.title).trim() || (kind === 'code' ? 'Untitled code' : 'Untitled document'),
        updatedAt: Math.max(written, previous?.updatedAt ?? 0),
        docId,
        messageId,
      });
    }

    const research = message.research as Record<string, unknown> | undefined;
    if (research && typeof research === 'object' && research.status === 'done' && str(research.report)) {
      documents.push({
        key: `${chatId}\u0000research\u0000${messageId}`,
        chatId,
        kind: 'research',
        title: str(research.title).trim() || 'Research',
        updatedAt: num(research.finishedAt) || num(research.startedAt),
        messageId,
      });
    }

    for (const itemRaw of Array.isArray(message.media) ? message.media : []) {
      const item = itemRaw as Record<string, unknown> | null;
      if (!item || typeof item !== 'object' || item.status !== 'done') continue;
      if (item.kind !== 'image' && item.kind !== 'video' && item.kind !== 'music') continue;
      const file = asAttachment(item.attachment);
      const mediaId = str(item.id);
      if (!file || !mediaId) continue;
      const kind = item.kind as LibraryMediaKind;
      media.push({
        key: `${chatId}\u0000media\u0000${mediaId}`,
        chatId,
        messageId,
        mediaId,
        kind,
        title: kind === 'music' ? str(item.title).trim() : '',
        prompt: str(item.prompt),
        createdAt: num(item.createdAt),
        file,
        thumbnail: kind === 'image' ? file : kind === 'music' ? asAttachment(item.cover) : file,
      });
    }
  }
  documents.push(...canvases.values());
  for (const doc of documents) if (!doc.updatedAt) doc.updatedAt = fallbackTime;
  for (const item of media) if (!item.createdAt) item.createdAt = fallbackTime;
  return { documents, media };
};

/** Newest first, then a stable key order so equal times never reshuffle. */
export const sortDocuments = (docs: LibraryDocument[]): LibraryDocument[] =>
  docs.sort((a, b) => (b.updatedAt - a.updatedAt) || a.key.localeCompare(b.key));
export const sortMedia = (items: LibraryMedia[]): LibraryMedia[] =>
  items.sort((a, b) => (b.createdAt - a.createdAt) || a.key.localeCompare(b.key));

/** The row's icon: Gemini's `TYPE_MY_STUFF_CANVAS_CODE` is `code`, Deep Research `deepResearch`, the rest `article`. */
export const documentIcon = (kind: LibraryDocumentKind): string =>
  kind === 'code' ? 'code' : kind === 'research' ? 'deep_research' : 'article';

/** The round badge on a tile: videos and music carry one, images none. */
export const mediaBadgeIcon = (kind: LibraryMediaKind): string | null =>
  kind === 'video' ? 'videocam' : kind === 'music' ? 'music_note' : null;

/** The glyph a tile without a picture shows under its title. */
export const mediaTypeIcon = (kind: LibraryMediaKind): string =>
  kind === 'video' ? 'videocam' : kind === 'music' ? 'music_note' : 'image_create';

/** "Untitled" when there is no title, as Gemini labels every generated image. */
export const mediaTitle = (item: Pick<LibraryMedia, 'title'>): string => item.title || 'Untitled';

/**
 * Gemini's `shortDateTime`: month short, day, hour and minutes in the page's language, so
 * "1 Oct, 4:33 pm" in English (India) and "Oct 1, 4:33 PM" in English (US). Willow formats in
 * the browser's own language, as its other dates do.
 */
export const formatLibraryDate = (time: number, locale?: string): string => {
  if (!time) return '';
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
};

/** A safe file name for a download, from the item's title or prompt. */
export const mediaFileName = (item: Pick<LibraryMedia, 'title' | 'prompt' | 'file' | 'kind'>): string => {
  const ext = item.file.extension || item.file.mimeType.split('/')[1] || (item.kind === 'image' ? 'png' : item.kind === 'video' ? 'mp4' : 'mp3');
  const stem = (item.title || item.prompt || (item.kind === 'image' ? 'Generated image' : item.kind === 'video' ? 'Generated video' : 'Generated track'))
    .replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Generated media';
  return `${stem}.${ext}`;
};

/**
 * A saved chat with one media item taken out of its message — what Delete writes back.
 * Returns null when the item is not there (already gone), so nothing is written.
 */
export const withoutMedia = (messages: readonly unknown[], messageId: string, mediaId: string): unknown[] | null => {
  let removed = false;
  const next = messages.map((raw) => {
    const message = raw as Record<string, unknown> | null;
    if (!message || typeof message !== 'object' || message.id !== messageId || !Array.isArray(message.media)) return raw;
    const media = (message.media as Array<Record<string, unknown>>).filter((item) => item?.id !== mediaId);
    if (media.length === (message.media as unknown[]).length) return raw;
    removed = true;
    const { media: _old, ...rest } = message;
    return media.length ? { ...rest, media } : rest;
  });
  return removed ? next : null;
};
