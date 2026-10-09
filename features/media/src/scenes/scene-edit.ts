// The Scenebuilder's "Describe how to edit this video…": an Omni Flash edit of one clip.
//
// Flow runs these on Omni 1.1 Flash with the clip itself as the input, and the result keeps the
// clip's motion (a walking cat stayed a walking cat, now at night). So the clip's video goes in
// as a video part. Should the endpoint refuse video input, the request is made once more with
// the frame under the playhead instead, which still edits — as an image-to-video.
//
// Same Interactions endpoint and response shapes as MediaView's `generateSingleVideo`.

export interface InlinePart {
  mimeType: string;
  data: string;
}

async function toInline(url: string): Promise<InlinePart> {
  const match = url.match(/^data:([^;]+);base64,(.+)$/);
  if (match) return { mimeType: match[1], data: match[2] };
  const blob = await (await fetch(url)).blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Could not read the clip.');
  return { mimeType: m[1], data: m[2] };
}

const typeOf = (mime: string) => (mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'image');

class EditRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request(apiKey: string, apiModelId: string, prompt: string, ratio: string, parts: InlinePart[]): Promise<string> {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      model: `models/${apiModelId}`,
      input: [
        { type: 'text', text: `${prompt}\n\n[System: Edit the attached video as described. Keep its aspect ratio of ${ratio}.]` },
        ...parts.map((p) => ({ type: typeOf(p.mimeType), mime_type: p.mimeType, data: p.data })),
      ],
      response_format: { type: 'video', aspect_ratio: ratio },
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err?.error?.message || err?.[0]?.error?.message || '';
    if (response.status === 429) throw new EditRequestError('Rate limit exceeded. Too many requests. Please wait a moment and try again.', 429);
    if (response.status === 403) throw new EditRequestError('Access forbidden. Please check your API key permissions and region restrictions.', 403);
    if (response.status === 503 || response.status === 504) throw new EditRequestError('The generation service is currently overloaded. Please wait a few seconds and try again.', response.status);
    throw new EditRequestError(msg || `API error (${response.status})`, response.status);
  }
  const data = await response.json();
  if (data?.promptFeedback?.blockReason === 'SAFETY' || data?.state === 'BLOCKED') {
    throw new EditRequestError('This prompt might violate our safety policies. Please try a different prompt or send feedback.', 400);
  }
  const step = (data?.steps || []).find((s: any) => s.type === 'model_output' || s.stepType === 'model_output' || s.step_type === 'model_output');
  const outParts = step ? (Array.isArray(step.content) ? step.content : (step.content?.parts || step.modelOutput?.parts || [])) : [];
  const video = outParts.find((p: any) => p.mime_type?.startsWith('video/') || p.mimeType?.startsWith('video/') || p.inlineData?.mimeType?.startsWith('video/') || p.videoMetadata?.uri || p.video_metadata?.uri);
  if (!video) throw new EditRequestError('The model was unable to edit this video. Try describing the change differently.', 200);
  if (video.inlineData?.data) return `data:${video.inlineData.mimeType};base64,${video.inlineData.data}`;
  if (video.data) return `data:${video.mime_type || video.mimeType || 'video/mp4'};base64,${video.data}`;
  const uri: string = video.videoMetadata?.uri || video.video_metadata?.uri;
  try {
    const sep = uri.includes('?') ? '&' : '?';
    const blob = await (await fetch(`${uri}${sep}key=${apiKey}`)).blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return uri;
  }
}

/**
 * Runs one edit. `frame` is used only if the endpoint rejects the clip as a video input.
 * Resolves to the edited video's URL (a durable data URL wherever the response allows).
 */
export async function requestSceneEdit(spec: {
  apiKey: string;
  apiModelId: string;
  prompt: string;
  ratio: string;
  clipUrl: string;
  frame: () => Promise<string>;
  references: string[];
}): Promise<string> {
  const refs = await Promise.all(spec.references.map(toInline));
  const clip = await toInline(spec.clipUrl);
  try {
    return await request(spec.apiKey, spec.apiModelId, spec.prompt, spec.ratio, [clip, ...refs]);
  } catch (error) {
    const status = error instanceof EditRequestError ? error.status : 0;
    if (status !== 400 && status !== 413 && status !== 415) throw error;
    const frame = await toInline(await spec.frame());
    return request(spec.apiKey, spec.apiModelId, spec.prompt, spec.ratio, [frame, ...refs]);
  }
}
