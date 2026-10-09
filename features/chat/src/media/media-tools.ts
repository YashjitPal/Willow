/**
 * The chat's media tools: `generate_image`, `generate_video`, `generate_music`.
 *
 * Declared for the composer tool the user attached (Gemini's "Create image", "Create video",
 * "Create music" chips), the way Canvas is, and all three on offer when no tool is attached,
 * so asking for a picture makes one as it does in Gemini. The executor publishes a card the moment a call
 * starts — the waiting state is part of the message, not a spinner off to the side — and fills
 * it in when the file lands. The generators themselves are the host's (they need the user's
 * key, model picks and attachment store), so this module stays free of React and storage.
 */
import type { ChatAttachment } from '@willow/core/attachments';
import { MediaGenerationError } from './media-clients';
import {
  IMAGE_ASPECT_RATIOS,
  VIDEO_ASPECT_RATIOS,
  normalizeAspectRatio,
  type GeneratedMedia,
  type GeneratedMediaKind,
} from './generated-media';

export const GENERATE_IMAGE = 'generate_image';
export const GENERATE_VIDEO = 'generate_video';
export const GENERATE_MUSIC = 'generate_music';

const TOOL_KIND: Record<string, GeneratedMediaKind> = {
  [GENERATE_IMAGE]: 'image',
  [GENERATE_VIDEO]: 'video',
  [GENERATE_MUSIC]: 'music',
};

export const isMediaToolCall = (name: string | undefined): boolean => !!name && name in TOOL_KIND;

/** What the composer's companion row chose for this message. */
export interface MediaToolOptions {
  aspectRatio?: string;
  musicLength?: 'short' | 'standard';
  vocals?: 'custom' | 'on' | 'instrumental';
  /** A genre name, or 'custom' to leave it to the prompt. */
  genre?: string;
  /** A gallery template: its name and the style it asks for. */
  template?: { name: string; prompt: string };
}

const IMAGE_DECLARATION = {
  name: GENERATE_IMAGE,
  description: 'Creates an image from a description and shows it to the user in the chat. Call it whenever the user asks for an image, picture, drawing, photo, illustration, logo or similar, and when they ask to change an image you made.',
  parameters: {
    type: 'OBJECT',
    properties: {
      prompt: {
        type: 'STRING',
        description: 'A complete, specific description of the image: subject, setting, composition, lighting, style and mood. Write it in English. For a change to an earlier image, describe the whole new image, not only the change.',
      },
      aspect_ratio: { type: 'STRING', enum: [...IMAGE_ASPECT_RATIOS], description: "The image's shape. Use the user's choice unless they ask for another." },
      use_previous_image: {
        type: 'BOOLEAN',
        description: 'True when the user asks to change an image already in this conversation ("make it cuter", "change the background", "now as a watercolor") rather than for a new one. The newest image in the conversation, yours or theirs, goes to the generator as the picture to change.',
      },
    },
    required: ['prompt'],
  },
};

const VIDEO_DECLARATION = {
  name: GENERATE_VIDEO,
  description: 'Creates a short video (up to about 8 seconds, with sound) from a description and shows it to the user in the chat. Call it whenever the user asks for a video, clip or animation.',
  parameters: {
    type: 'OBJECT',
    properties: {
      prompt: {
        type: 'STRING',
        description: 'A complete description of the video: subject, action, camera movement, setting, lighting, style and any sound or dialogue. Write it in English.',
      },
      aspect_ratio: { type: 'STRING', enum: [...VIDEO_ASPECT_RATIOS], description: "16:9 landscape or 9:16 portrait. Use the user's choice unless they ask for another." },
      use_previous_image: {
        type: 'BOOLEAN',
        description: 'True when the user asks to animate an image already in this conversation ("animate it", "bring it to life"). The newest image in the conversation becomes the first frame.',
      },
    },
    required: ['prompt'],
  },
};

const MUSIC_DECLARATION = {
  name: GENERATE_MUSIC,
  description: 'Creates a music track (with cover art) from a description and shows it to the user in the chat as a player. Call it whenever the user asks for a song, track, jingle, beat or other music.',
  parameters: {
    type: 'OBJECT',
    properties: {
      prompt: {
        type: 'STRING',
        description: 'A complete description of the track: genre, mood, tempo, instruments, vocal style, and what it is about. Write it in English.',
      },
      title: { type: 'STRING', description: 'A short, catchy title for the track, shown on its cover.' },
      lyrics: { type: 'STRING', description: 'The lyrics, when the track has vocals. Omit for an instrumental, or to let the generator write them.' },
    },
    required: ['prompt', 'title'],
  },
};

/** A turn's media tools: the one its composer chip asked for, all three on offer, or none. */
export type MediaToolMode = GeneratedMediaKind | 'auto' | null;

/** The declarations for this message's tool. */
export const mediaChatTools = (mode: MediaToolMode): { functionDeclarations: any[] }[] => {
  if (mode === 'image') return [{ functionDeclarations: [IMAGE_DECLARATION] }];
  if (mode === 'video') return [{ functionDeclarations: [VIDEO_DECLARATION] }];
  if (mode === 'music') return [{ functionDeclarations: [MUSIC_DECLARATION] }];
  if (mode === 'auto') return [{ functionDeclarations: [IMAGE_DECLARATION, VIDEO_DECLARATION, MUSIC_DECLARATION] }];
  return [];
};

/** The composer tool → the kind of media it makes. */
export const mediaKindForTool = (tool: string | null | undefined): GeneratedMediaKind | null =>
  tool === 'images' ? 'image' : tool === 'video' ? 'video' : tool === 'music' ? 'music' : null;

/** The system-prompt block for this message's tool. */
export const mediaInstructions = (kind: MediaToolMode, options: MediaToolOptions = {}): string => {
  if (!kind) return '';
  if (kind === 'auto') {
    return `## Creating images, videos and music
You can make an image with ${GENERATE_IMAGE}, a short video with ${GENERATE_VIDEO} and a music track with ${GENERATE_MUSIC}. Call one when the user asks you to create, draw, generate, edit or change a picture, photo, illustration or logo; a video or clip; or a song, track or jingle. Nothing else is a reason to: explaining, finding or describing things, and charts, diagrams, code, web pages and documents, are answered as usual. Make one per request unless the user asks for more, and never make one on your own initiative.
An image the user attached to this message goes to the tool with the call, as the picture to edit or the still to animate. When they ask to change or animate an image already in the conversation ("make it cuter", "animate it"), set use_previous_image to true, and write the prompt for the whole new image.
After ${GENERATE_IMAGE} the image is already on screen, and anything you write next goes under it: write nothing, or at most one short sentence, and never describe it. After ${GENERATE_VIDEO} reply with exactly "Your video is ready!" and nothing else, unless the call failed. After ${GENERATE_MUSIC} write one short, warm sentence introducing the track, and never print the lyrics.`;
  }
  const template = options.template
    ? `\nThe user picked the "${options.template.name}" template from the gallery. Apply it: ${options.template.prompt} If they wrote nothing else, make something good in that style anyway.`
    : '';
  if (kind === 'image') {
    return `## Creating images
The user turned on "Create image" for this message, so make an image for what they ask by calling ${GENERATE_IMAGE}. Do not answer with text instead, and do not ask questions first unless the request is impossible to act on.
Their chosen aspect ratio is ${normalizeAspectRatio(options.aspectRatio, '1:1')}.${template}
When they ask to change an image already in the conversation ("make it cuter"), set use_previous_image to true, and write the prompt for the whole new image.
After the call, the image is already on screen, and anything you write next goes under it: write nothing, or at most one short sentence. Never describe the image or repeat the prompt.`;
  }
  if (kind === 'video') {
    return `## Creating videos
The user turned on "Create video" for this message, so make a video for what they ask by calling ${GENERATE_VIDEO}. Do not answer with text instead.
Their chosen aspect ratio is ${normalizeAspectRatio(options.aspectRatio, '16:9')}.${template}
When they ask to animate an image already in the conversation ("animate it"), set use_previous_image to true.
After the call, the video is already on screen: reply with exactly "Your video is ready!" and nothing else, unless the call failed.`;
  }
  const length = options.musicLength === 'standard' ? 'a full-length track' : 'a short track (about 30 seconds)';
  const vocals = options.vocals === 'instrumental' ? ' It must be instrumental, with no vocals.' : options.vocals === 'on' ? ' It must have vocals.' : '';
  const genre = options.genre && options.genre !== 'custom' ? ` The genre is ${options.genre}.` : '';
  return `## Creating music
The user turned on "Create music" for this message, so make ${length} for what they ask by calling ${GENERATE_MUSIC}.${vocals}${genre} Do not answer with text instead.${template}
After the call, the track is already on screen as a player: write one short, warm sentence introducing it, and nothing else. Never print the lyrics.`;
};

/** What the host's generators hand back. */
export interface MediaGenerationResult {
  attachment: ChatAttachment;
  cover?: ChatAttachment;
  title?: string;
  lyrics?: string;
  width?: number;
  height?: number;
  durationSec?: number;
}

export interface MediaGenerationRequest {
  prompt: string;
  aspectRatio: string;
  title?: string;
  lyrics?: string;
  /** Start from the newest image in the conversation: an edit's source, a video's first frame. */
  usePreviousImage?: boolean;
  signal: AbortSignal;
}

export interface MediaToolHost {
  options: MediaToolOptions;
  generate: (kind: GeneratedMediaKind, request: MediaGenerationRequest) => Promise<MediaGenerationResult>;
  /** How much reply text exists, so the card lands after it. */
  contentLength: () => number;
  publish: (item: GeneratedMedia) => void;
  update: (id: string, patch: Partial<GeneratedMedia>) => void;
  signal: AbortSignal;
  newId?: () => string;
}

export type MediaToolResult = { status: 'ok'; result: string } | { status: 'error'; error: string };

const DONE_RESULT: Record<GeneratedMediaKind, string> = {
  image: 'The image was created and is on screen; anything you write next appears under it. Do not describe it.',
  video: 'The video was created and is shown to the user below your reply.',
  music: 'The track was created and is shown to the user as a player below your reply.',
};

const randomId = (): string => `gm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const createMediaToolExecutor = (host: MediaToolHost) => async (name: string, args: any): Promise<MediaToolResult> => {
  const kind = TOOL_KIND[name];
  if (!kind) return { status: 'error', error: `Unknown tool ${name}.` };
  const prompt = typeof args?.prompt === 'string' ? args.prompt.trim() : '';
  if (!prompt) return { status: 'error', error: 'No prompt was provided. Call again with a `prompt` describing what to create.' };
  const fallbackRatio = kind === 'video' ? '16:9' : '1:1';
  const chosen = normalizeAspectRatio(host.options.aspectRatio, fallbackRatio);
  let aspectRatio = normalizeAspectRatio(args?.aspect_ratio, chosen);
  if (kind === 'video' && aspectRatio !== '9:16') aspectRatio = '16:9';
  if (kind === 'music') aspectRatio = '1:1';

  const id = (host.newId ?? randomId)();
  host.publish({
    id,
    kind,
    status: 'generating',
    prompt,
    index: host.contentLength(),
    aspectRatio,
    title: kind === 'music' && typeof args?.title === 'string' ? args.title.trim() || undefined : undefined,
    createdAt: Date.now(),
  });
  try {
    const result = await host.generate(kind, {
      prompt,
      aspectRatio,
      title: typeof args?.title === 'string' ? args.title.trim() : undefined,
      lyrics: typeof args?.lyrics === 'string' ? args.lyrics.trim() : undefined,
      usePreviousImage: kind !== 'music' && (args?.use_previous_image === true || args?.use_previous_image === 'true'),
      signal: host.signal,
    });
    host.update(id, {
      status: 'done',
      attachment: result.attachment,
      cover: result.cover,
      title: result.title,
      lyrics: result.lyrics,
      width: result.width,
      height: result.height,
      durationSec: result.durationSec,
    });
    return { status: 'ok', result: DONE_RESULT[kind] };
  } catch (error) {
    const aborted = host.signal.aborted || (error as { name?: string } | null)?.name === 'AbortError';
    const message = aborted
      ? 'Stopped.'
      : error instanceof MediaGenerationError
        ? error.message
        : 'Something went wrong while generating. Try again.';
    host.update(id, { status: 'error', error: message });
    return { status: 'error', error: aborted ? 'The user stopped the generation.' : `${message} Tell the user in one short sentence; do not retry unless they ask.` };
  }
};
