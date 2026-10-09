/**
 * What the chat's media tools make, as it sits on an assistant message.
 *
 * One `GeneratedMedia` per tool call: it is published the instant the call starts (status
 * `generating`, which draws Gemini's waiting state) and updated in place when the file lands.
 * The bytes are a chat attachment like any upload — kept in IndexedDB and beside the chat's
 * file — so `attachment` is the same persisted metadata `ChatMsg.attachments` carries.
 */
import type { ChatAttachment } from '@willow/core/attachments';

export type GeneratedMediaKind = 'image' | 'video' | 'music';
export type GeneratedMediaStatus = 'generating' | 'done' | 'error';

export interface GeneratedMedia {
  id: string;
  kind: GeneratedMediaKind;
  status: GeneratedMediaStatus;
  /** What the model asked the generator for. */
  prompt: string;
  /** Where in the reply the card sits, as a character offset (cards render after it). */
  index: number;
  /** `1:1`, `16:9`, … — sizes the waiting placeholder before the file exists. */
  aspectRatio?: string;
  /** The generated file. Absent until `done`. */
  attachment?: ChatAttachment;
  /** Music: the cover art the track plays over. */
  cover?: ChatAttachment;
  /** Music: the track's name, set on its cover. */
  title?: string;
  /** Music: the words, for the player's subtitles. */
  lyrics?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  /** Why it failed, in words for the user. */
  error?: string;
  createdAt: number;
}

/**
 * The line in the thinking row while a call runs — Gemini's own strings, read off the live
 * app: "Creating your image", the long video notice, "Generating your track".
 */
export const GENERATING_STATUS: Record<GeneratedMediaKind, string> = {
  image: 'Creating your image',
  video: "I'm generating your video. This could take a few minutes, so check back to see when your video is ready.",
  music: 'Generating your track',
};

/** The status line for a message, from the newest call still running on it. */
export const generatingStatusFor = (media: readonly GeneratedMedia[] | undefined): string | null => {
  if (!media?.length) return null;
  for (let i = media.length - 1; i >= 0; i -= 1) {
    if (media[i].status === 'generating') return GENERATING_STATUS[media[i].kind];
  }
  return null;
};

const ASPECT_RATIOS = new Set(['1:1', '9:16', '3:4', '4:3', '16:9']);
export const IMAGE_ASPECT_RATIOS = ['1:1', '9:16', '3:4', '4:3', '16:9'] as const;
export const VIDEO_ASPECT_RATIOS = ['16:9', '9:16'] as const;

export const normalizeAspectRatio = (value: unknown, fallback: string): string =>
  typeof value === 'string' && ASPECT_RATIOS.has(value.trim()) ? value.trim() : fallback;

/** `16:9` as a CSS `aspect-ratio` value. */
export const cssAspectRatio = (ratio: string | undefined): string => {
  const [w, h] = String(ratio || '1:1').split(':').map(Number);
  return w > 0 && h > 0 ? `${w} / ${h}` : '1 / 1';
};

const asAttachment = (value: unknown): ChatAttachment | undefined => {
  const a = value as ChatAttachment | null;
  if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !a.id || typeof a.name !== 'string') return undefined;
  const { url: _url, unavailable: _unavailable, ...persisted } = a;
  return persisted as ChatAttachment;
};

/**
 * A saved message's media, made safe to render.
 *
 * A call still `generating` on disk belongs to a tab that died mid-generation: nothing will
 * ever finish it, so it loads as failed rather than shimmering forever.
 */
export const sanitizeSavedMedia = (value: unknown): GeneratedMedia[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const out: GeneratedMedia[] = [];
  for (const raw of value) {
    const item = raw as Partial<GeneratedMedia> | null;
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) continue;
    if (item.kind !== 'image' && item.kind !== 'video' && item.kind !== 'music') continue;
    const attachment = asAttachment(item.attachment);
    const status: GeneratedMediaStatus = item.status === 'done' && attachment ? 'done' : 'error';
    out.push({
      id: item.id,
      kind: item.kind,
      status,
      prompt: typeof item.prompt === 'string' ? item.prompt : '',
      index: Number.isFinite(item.index) ? Math.max(0, Number(item.index)) : 0,
      aspectRatio: typeof item.aspectRatio === 'string' ? item.aspectRatio : undefined,
      attachment,
      cover: asAttachment(item.cover),
      title: typeof item.title === 'string' ? item.title : undefined,
      lyrics: typeof item.lyrics === 'string' ? item.lyrics : undefined,
      width: Number.isFinite(item.width) ? Number(item.width) : undefined,
      height: Number.isFinite(item.height) ? Number(item.height) : undefined,
      durationSec: Number.isFinite(item.durationSec) ? Number(item.durationSec) : undefined,
      error: status === 'error' ? (typeof item.error === 'string' && item.error ? item.error : "This didn't finish generating.") : undefined,
      createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : 0,
    });
  }
  return out.length ? out : undefined;
};

/** The attachments a message's media points at, for saving and hydrating. */
export const mediaAttachments = (media: readonly GeneratedMedia[] | undefined): ChatAttachment[] =>
  (media ?? []).flatMap((item) => [item.attachment, item.cover].filter((a): a is ChatAttachment => !!a));
