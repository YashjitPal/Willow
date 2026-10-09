/**
 * The media executor's host for a chat turn: which models make the files, on which key, and
 * where the files go. Built by `buildChatTurnSetup` from the turn's settings plus the view's
 * attachment store.
 */
import type { ChatAttachment, ChatAttachmentKind } from '@willow/core/attachments';
import { mediaModelLists, readModelPick, resolveModelPick } from '@willow/media/media-models';
import {
  MediaGenerationError,
  generateImage,
  generateMusic,
  generateVideo,
  type InlineImage,
} from './media-clients';
import type { MediaGenerationResult, MediaToolHost, MediaToolOptions } from './media-tools';

/** Keeps a generated file the way an upload is kept, and hands back its attachment. */
export interface ChatMediaStore {
  keep: (file: { blob: Blob; mimeType: string; name: string; kind: ChatAttachmentKind }) => Promise<ChatAttachment>;
}

/** Lyria's request ids: the saved `lyria-3` is the 30-second clip model, anything else Pro. */
export const lyriaApiModel = (id: string, length: MediaToolOptions['musicLength']): string => {
  if (/preview/.test(id)) return id;
  if (length === 'short' || id === 'lyria-3') return 'lyria-3-clip-preview';
  return 'lyria-3-pro-preview';
};

/** A cover drawn on the device when there is no image model to paint one. */
const drawCover = async (title: string): Promise<Blob | null> => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const hue = [...title].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360;
  const gradient = ctx.createLinearGradient(0, 0, 1024, 1024);
  gradient.addColorStop(0, `hsl(${hue} 55% 38%)`);
  gradient.addColorStop(1, `hsl(${(hue + 50) % 360} 60% 16%)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1024, 1024);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'right';
  ctx.font = '700 120px "Google Sans Flex", "Google Sans", sans-serif';
  const words = title.toUpperCase().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const lastLine = lines[lines.length - 1];
    if (lastLine && ctx.measureText(`${lastLine} ${word}`).width < 820) lines[lines.length - 1] = `${lastLine} ${word}`;
    else lines.push(word);
  }
  lines.slice(-4).forEach((line, i, all) => ctx.fillText(line, 940, 940 - (all.length - 1 - i) * 128));
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
};

export const createChatMediaHost = ({
  apiKey,
  modelConfig,
  scopeId,
  options,
  store,
  inputImages = [],
  previousImage,
}: {
  /** The Gemini key media is generated on, or '' when there is none. */
  apiKey: string;
  modelConfig: unknown;
  scopeId: string;
  options: MediaToolOptions;
  store: ChatMediaStore;
  /** Images attached to this message: an edit's source, or a still to animate. */
  inputImages?: InlineImage[];
  /**
   * The newest image already in the conversation, read only when a call asks for it
   * (`use_previous_image`): "make it cuter" sends no attachment, and the generator would
   * otherwise start from nothing.
   */
  previousImage?: () => Promise<InlineImage | null>;
}): Pick<MediaToolHost, 'options' | 'generate'> => ({
  options,
  generate: async (kind, request): Promise<MediaGenerationResult> => {
    if (!apiKey) throw new MediaGenerationError('Add a Gemini API key in Settings to create images, videos and music.');
    const lists = mediaModelLists(modelConfig);
    const previous = request.usePreviousImage && previousImage ? await previousImage() : null;

    if (kind === 'image') {
      const model = resolveModelPick(readModelPick('image', scopeId), lists.image);
      if (!model) throw new MediaGenerationError('Add an image model in Settings → Models to create images.');
      const file = await generateImage({
        apiKey,
        model,
        prompt: request.prompt,
        aspectRatio: request.aspectRatio,
        // The picture being changed first, then anything sent with this message to work in.
        images: previous ? [previous, ...inputImages] : inputImages,
        signal: request.signal,
      });
      const attachment = await store.keep({ blob: file.blob, mimeType: file.mimeType, name: 'Generated image', kind: 'image' });
      return { attachment, width: file.width, height: file.height };
    }

    if (kind === 'video') {
      const pick = resolveModelPick(readModelPick('video', scopeId), lists.video);
      const model = lists.video.find((option) => option.id === pick);
      if (!model) throw new MediaGenerationError('Add a video model in Settings → Models to create videos.');
      const file = await generateVideo({
        apiKey,
        model: model.apiId,
        prompt: request.prompt,
        aspectRatio: request.aspectRatio,
        image: inputImages[0] ?? previous ?? undefined,
        signal: request.signal,
      });
      const attachment = await store.keep({ blob: file.blob, mimeType: file.mimeType, name: 'Generated video', kind: 'video' });
      return { attachment };
    }

    const musicPick = resolveModelPick(readModelPick('music', scopeId), lists.music);
    if (!musicPick) throw new MediaGenerationError('Add a Lyria model in Settings → Models to create music.');
    const title = request.title || request.prompt.split(/\s+/).slice(0, 4).join(' ');
    const hints = [
      options.vocals === 'instrumental' ? 'Instrumental only, no vocals.' : options.vocals === 'on' ? 'With vocals.' : '',
      options.genre && options.genre !== 'custom' ? `Genre: ${options.genre}.` : '',
    ].filter(Boolean).join(' ');
    const track = await generateMusic({
      apiKey,
      model: lyriaApiModel(musicPick, options.musicLength),
      prompt: `${request.prompt}${hints ? ` ${hints}` : ''}${request.lyrics ? `\n\nLyrics:\n${request.lyrics}` : ''}`,
      signal: request.signal,
    });
    const attachment = await store.keep({ blob: track.audio.blob, mimeType: track.audio.mimeType, name: title, kind: 'audio' });

    let coverBlob: Blob | null = null;
    const coverModel = resolveModelPick(readModelPick('image', scopeId), lists.image);
    if (coverModel) {
      try {
        const cover = await generateImage({
          apiKey,
          model: coverModel,
          prompt: `Square album cover art for a track titled "${title}". Mood and subject: ${request.prompt}. Set the title "${title}" in large, bold, clean white type in the lower right. Cinematic, premium, no other text.`,
          aspectRatio: '1:1',
          signal: request.signal,
        });
        coverBlob = cover.blob;
      } catch (error) {
        if ((error as { name?: string } | null)?.name === 'AbortError') throw error;
      }
    }
    coverBlob = coverBlob ?? await drawCover(title);
    const cover = coverBlob
      ? await store.keep({ blob: coverBlob, mimeType: coverBlob.type || 'image/png', name: `${title} cover`, kind: 'image' })
      : undefined;
    return { attachment, cover, title, lyrics: track.lyrics || request.lyrics };
  },
});
