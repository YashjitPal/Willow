/**
 * One picture from a Gemini image model: a prompt in, an image out.
 *
 * The request is the one Media's prompt box makes (`generateContent` with an
 * IMAGE response and an image config), shared here for callers outside Media —
 * the Code harness's `generate_image` — with the same readable failures.
 */

export interface GeneratedImage {
  mimeType: string;
  /** Base64, without a data-URL prefix. */
  data: string;
}

export const IMAGE_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'] as const;
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];

export interface GenerateImageOptions {
  apiKey: string;
  /** The id Google serves the model under. */
  model: string;
  prompt: string;
  /** Pictures the new one is drawn from, sent ahead of the prompt. */
  images?: GeneratedImage[];
  aspectRatio?: ImageAspectRatio;
  /** A profile's own endpoint; Google's when absent. */
  baseUrl?: string;
  signal?: AbortSignal;
}

const DEFAULT_ORIGIN = 'https://generativelanguage.googleapis.com';

function endpoint(baseUrl: string | undefined, model: string, apiKey: string): string {
  const root = (baseUrl || DEFAULT_ORIGIN).replace(/\/+$/, '');
  const versioned = /\/v1(beta)?$/.test(root) ? root : `${root}/v1beta`;
  return `${versioned}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

export async function generateGeminiImage(options: GenerateImageOptions): Promise<GeneratedImage> {
  const response = await fetch(endpoint(options.baseUrl, options.model, options.apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
    body: JSON.stringify({
      contents: [{ parts: [...(options.images ?? []).map((image) => ({ inlineData: image })), { text: options.prompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: options.aspectRatio ?? '1:1', imageSize: '1K' },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
    const message = body?.error?.message ?? '';
    if (response.status === 400 && /key/i.test(message)) throw new Error('The Gemini API key was rejected. Check it in Settings → Models.');
    if (response.status === 403) throw new Error('The Gemini API key is not allowed to use this image model.');
    if (response.status === 404) throw new Error(`The image model "${options.model}" was not found.`);
    if (response.status === 429) throw new Error('Image generation is rate limited right now. Try again in a moment.');
    if (response.status >= 500) throw new Error('The image service is overloaded right now. Try again in a moment.');
    throw new Error(message || `Image generation failed (HTTP ${response.status}).`);
  }

  const data = await response.json() as {
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
  };
  if (data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason === 'SAFETY') {
    throw new Error('The image model declined this prompt on safety grounds.');
  }
  if (data.candidates?.[0]?.finishReason === 'RECITATION') {
    throw new Error('The image model declined this prompt because it would reproduce protected material.');
  }
  const part = data.candidates?.[0]?.content?.parts?.find((candidate) => candidate.inlineData?.mimeType?.startsWith('image/'));
  if (!part?.inlineData?.data) throw new Error('The image model returned no image. Describe the picture in more detail.');
  return { mimeType: part.inlineData.mimeType!, data: part.inlineData.data };
}
