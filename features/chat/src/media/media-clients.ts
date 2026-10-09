/**
 * The three generators the chat's media tools call, on the user's own Gemini key — the same
 * request shapes Media's studio uses (`features/media/src/MediaView.tsx`, `music/MusicView.tsx`),
 * reduced to "prompt in, file out".
 */

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

/** An image handed to a generator as input: an edit's source, or an upload to animate. */
export interface InlineImage {
  mimeType: string;
  /** Base64, no `data:` prefix. */
  data: string;
}

export interface GeneratedFile {
  blob: Blob;
  mimeType: string;
  width?: number;
  height?: number;
}

/** A failure with a sentence fit to show the user. */
export class MediaGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaGenerationError';
  }
}

const apiError = (status: number, message: string): MediaGenerationError => {
  const lower = message.toLowerCase();
  if (status === 400 && lower.includes('key')) return new MediaGenerationError('Your Gemini API key was rejected. Check it in Settings.');
  if (status === 403) return new MediaGenerationError('Your Gemini API key does not have access to this model.');
  if (status === 404) return new MediaGenerationError('This model is not available on your Gemini API key.');
  if (status === 429) return new MediaGenerationError("You've hit your generation limit for now. Try again in a little while.");
  if (status === 503 || status === 504) return new MediaGenerationError('The generator is busy right now. Try again in a moment.');
  if (lower.includes('safety') || lower.includes('blocked')) return new MediaGenerationError("I can't create that. Try describing something else.");
  return new MediaGenerationError(message || `The generator returned an error (${status}).`);
};

const readError = async (res: Response): Promise<MediaGenerationError> => {
  const body = await res.json().catch(() => ({}));
  const message = body?.error?.message || body?.[0]?.error?.message || '';
  return apiError(res.status, String(message));
};

export const base64ToBlob = (data: string, mimeType: string): Blob => {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
};

export const blobToInlineImage = async (blob: Blob): Promise<InlineImage> => {
  const buffer = await blob.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { mimeType: blob.type || 'image/png', data: btoa(bin) };
};

const imageSize = (blob: Blob): Promise<{ width?: number; height?: number }> => new Promise((resolve) => {
  if (typeof Image === 'undefined' || typeof URL === 'undefined') { resolve({}); return; }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
  img.onerror = () => { resolve({}); URL.revokeObjectURL(url); };
  img.src = url;
});

const blocked = (data: any): boolean =>
  data?.promptFeedback?.blockReason || ['SAFETY', 'PROHIBITED_CONTENT', 'IMAGE_SAFETY'].includes(data?.candidates?.[0]?.finishReason);

/** One image from a Gemini image model (`generateContent`, image out). */
export const generateImage = async ({
  apiKey,
  model,
  prompt,
  aspectRatio,
  images = [],
  signal,
}: {
  apiKey: string;
  model: string;
  prompt: string;
  aspectRatio: string;
  images?: InlineImage[];
  signal?: AbortSignal;
}): Promise<GeneratedFile> => {
  const res = await fetch(`${GEMINI_API}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    signal,
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }, ...images.map((image) => ({ inlineData: image }))] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio } },
    }),
  });
  if (!res.ok) throw await readError(res);
  const data = await res.json();
  if (blocked(data)) throw new MediaGenerationError("I can't create that image. Try describing something else.");
  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  const part = parts.find((p) => p?.inlineData?.mimeType?.startsWith('image/') && p.inlineData.data);
  if (!part) throw new MediaGenerationError("The model didn't return an image. Try adding more detail.");
  const blob = base64ToBlob(part.inlineData.data, part.inlineData.mimeType);
  return { blob, mimeType: part.inlineData.mimeType, ...(await imageSize(blob)) };
};

const sleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

/** Veo takes 4, 6 or 8 seconds; Omni Flash 3 to 10. */
const VEO_DURATIONS = [4, 6, 8];

/** One video: Veo through a long-running predict, Omni Flash through the Interactions API. */
export const generateVideo = async ({
  apiKey,
  model,
  prompt,
  aspectRatio,
  durationSec = 8,
  image,
  signal,
}: {
  apiKey: string;
  /** The id the request names (`veo-3.1-fast-generate-preview`, `gemini-omni-flash-preview`, …). */
  model: string;
  prompt: string;
  aspectRatio: string;
  durationSec?: number;
  image?: InlineImage;
  signal?: AbortSignal;
}): Promise<GeneratedFile> => {
  if (/omni/i.test(model)) {
    const res = await fetch(`${GEMINI_API}/interactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal,
      body: JSON.stringify({
        model: `models/${model}`,
        input: [
          { type: 'text', text: `${prompt}\n\n[System: Please generate this video with an aspect ratio of ${aspectRatio} and a duration of ${Math.min(10, Math.max(3, durationSec))} seconds.]` },
          ...(image ? [{ type: 'image', mime_type: image.mimeType, data: image.data }] : []),
        ],
        response_format: { type: 'video', aspect_ratio: aspectRatio },
      }),
    });
    if (!res.ok) throw await readError(res);
    const data = await res.json();
    if (data?.state === 'BLOCKED' || blocked(data)) throw new MediaGenerationError("I can't create that video. Try describing something else.");
    for (const step of data?.steps ?? []) {
      const parts: any[] = Array.isArray(step?.content) ? step.content : step?.content?.parts ?? [];
      for (const part of parts) {
        const mime = part?.mime_type || part?.mimeType || part?.inlineData?.mimeType;
        const b64 = part?.data || part?.inlineData?.data;
        if (mime?.startsWith('video/') && b64) return { blob: base64ToBlob(b64, mime), mimeType: mime };
        const uri = part?.videoMetadata?.uri || part?.video_metadata?.uri;
        if (uri) {
          const file = await fetch(`${uri}${uri.includes('?') ? '&' : '?'}key=${apiKey}`, { signal });
          if (file.ok) { const blob = await file.blob(); return { blob, mimeType: blob.type || 'video/mp4' }; }
        }
      }
    }
    throw new MediaGenerationError("The model didn't return a video. Try adding more detail.");
  }

  const seconds = VEO_DURATIONS.filter((d) => d <= durationSec).pop() ?? VEO_DURATIONS[0];
  const start = await fetch(`${GEMINI_API}/models/${encodeURIComponent(model)}:predictLongRunning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    signal,
    body: JSON.stringify({
      instances: [{ prompt, ...(image ? { image: { imageBytes: image.data, mimeType: image.mimeType } } : {}) }],
      parameters: { aspectRatio, durationSeconds: seconds, personGeneration: 'allow_all' },
    }),
  });
  if (!start.ok) throw await readError(start);
  const operation: string | undefined = (await start.json())?.name;
  if (!operation) throw new MediaGenerationError("The video service didn't start the job. Try again.");

  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(5000, signal);
    const poll = await fetch(`${GEMINI_API}/${operation}`, { headers: { 'x-goog-api-key': apiKey }, signal });
    if (!poll.ok) continue;
    const data = await poll.json();
    if (!data?.done) continue;
    if (data.error) throw apiError(400, String(data.error.message || 'Video generation failed.'));
    const uri: string | undefined = data?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
      ?? data?.response?.videos?.[0]?.uri
      ?? data?.response?.generatedVideos?.[0]?.video?.uri;
    if (!uri) throw new MediaGenerationError("I can't create that video. Try describing something else.");
    const file = await fetch(`${uri}${uri.includes('?') ? '&' : '?'}key=${apiKey}`, { signal });
    if (!file.ok) throw await readError(file);
    const blob = await file.blob();
    return { blob, mimeType: blob.type || 'video/mp4' };
  }
  throw new MediaGenerationError('The video took too long to generate. Try again.');
};

export interface GeneratedTrack {
  audio: GeneratedFile;
  /** Lyria's own text: the lyrics, often with `[mm:ss]` stamps. */
  lyrics: string;
}

/** One track from Lyria 3, through the Interactions API. */
export const generateMusic = async ({
  apiKey,
  model,
  prompt,
  signal,
}: {
  apiKey: string;
  /** `lyria-3-clip-preview` or `lyria-3-pro-preview`. */
  model: string;
  prompt: string;
  signal?: AbortSignal;
}): Promise<GeneratedTrack> => {
  const res = await fetch(`${GEMINI_API}/interactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    signal,
    body: JSON.stringify({ model, input: prompt }),
  });
  if (!res.ok) throw await readError(res);
  const data = await res.json();
  let audio: GeneratedFile | null = null;
  let lyrics = '';
  for (const step of data?.steps ?? []) {
    if (step?.type !== 'model_output' || !Array.isArray(step.content)) continue;
    for (const block of step.content) {
      if (block?.type === 'audio' && block.data && !audio) {
        const mime = block.mime_type || block.mimeType || 'audio/mpeg';
        audio = { blob: base64ToBlob(block.data, mime), mimeType: mime };
      } else if (block?.type === 'text' && block.text) {
        lyrics += `${block.text}\n`;
      }
    }
  }
  if (!audio) throw new MediaGenerationError("I couldn't make that track. Try describing it differently.");
  return { audio, lyrics: lyrics.trim() };
};
