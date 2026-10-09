/**
 * A running tool's requests, answered by Willow: what `bridge.ts` calls for each `FLOW_*`
 * message. Flow's host does the same in its view page (`F4b` in its bundle):
 *
 * - generate.image / generate.video run the project's own generation (the agent's start), so a
 *   tool's results appear in the gallery like any other, and fail with Flow's snackbar;
 * - generate.text asks Gemini with the user's key (Flow's TEXT_GENERATION model is a Flash);
 * - save puts the file in the gallery with "Saving to gallery…" → "Saved to gallery"; upload
 *   does the same quietly;
 * - select opens the media picker (the page supplies it) and returns each pick with its bytes.
 *
 * A tool names models by Flow's display names ("🍌 Nano Banana Pro", "Veo 3.1 - Fast"); each
 * resolves to the user's added model with the most matching words, else their current pick.
 */
import { getGeminiClient } from '@willow/ai/chat';
import type { MediaItem } from '../types';
import { MEDIA_AGENT_MODEL } from '../agent/agent-tools';
import { dismissSnack, showSnack, updateSnack } from '../scenes/scene-store';
import type { MediaFilter, ToolMediaItem, ToolSdkHost } from './runtime/bridge';
import { base64ToBytes } from './runtime/bridge';
import { saveLocalStorage, toolStorage } from './tools-store';
import type { ToolsHost } from './tools-host';

export interface MediaPickRequest {
  filter: MediaFilter;
  multiple: boolean;
  maxCount?: number;
  preSelectedIds?: string[];
}

const words = (s: string): string[] =>
  s.toLowerCase().replace(/[-_]/g, ' ').replace(/[^\p{L}\p{N}.\s]/gu, ' ').split(/\s+/).filter((w) => w && w !== 'quality' && w !== 'gemini');

/** The added model a Flow display name means, by shared words; undefined when none is close. */
export function matchModelName(displayName: string | undefined, models: readonly { id: string; name: string }[]): string | undefined {
  if (!displayName) return undefined;
  const want = words(displayName);
  if (want.length === 0) return undefined;
  let best: string | undefined;
  let bestScore = 0;
  for (const model of models) {
    const have = new Set([...words(model.name), ...words(model.id)]);
    const hits = want.filter((w) => have.has(w)).length;
    if (hits === 0) continue;
    const score = hits / want.length - Math.max(0, have.size - hits) * 0.01;
    if (score > bestScore) { best = model.id; bestScore = score; }
  }
  return bestScore >= 0.6 ? best : undefined;
}

const RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '4:5', '5:4', '3:2', '2:3']);
const fitRatio = (ratio: string | undefined, fallback: string): string => {
  const r = (ratio ?? '').replace(/\s/g, '').replace('/', ':');
  return RATIOS.has(r) ? r : fallback;
};

async function urlToBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const blob = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Could not read the file (${r.status}).`);
    return r.blob();
  });
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsDataURL(blob);
  });
  const [head, data = ''] = dataUrl.split(',');
  return { base64: data, mimeType: blob.type || /data:([^;]+)/.exec(head ?? '')?.[1] || 'application/octet-stream' };
}

const itemType = (item: MediaItem): ToolMediaItem['type'] => (item.kind === 'video' ? 'video' : item.kind === 'audio' ? 'audio' : 'image');
const itemName = (item: MediaItem): string =>
  item.shortenedPrompt || item.prompt || (item.kind === 'video' ? 'Selected video' : item.kind === 'audio' ? 'Selected audio' : 'Selected image');

export function createToolSdkHost(
  toolId: string,
  host: () => ToolsHost,
  pickMedia: (request: MediaPickRequest) => Promise<MediaItem[] | null>,
): ToolSdkHost {
  /** Items this tool picked from other projects (adopted copies), so later ids still resolve. */
  const known = new Map<string, MediaItem>();
  const findItem = (id: string): MediaItem | undefined => known.get(id) ?? host().mediaItems.find((m) => m.id === id);
  const requireItems = (ids: readonly string[] | undefined, what: string): MediaItem[] =>
    (ids ?? []).map((id) => {
      const item = findItem(id);
      if (!item?.url) throw new Error(`No ${what} with mediaId ${id} in this project.`);
      return item;
    });

  const awaitOne = async (start: ReturnType<ToolsHost['startImages']>, what: 'image' | 'video') => {
    if ('error' in start) throw new Error(start.error);
    const [outcome] = await start.done;
    if (!outcome || outcome.status !== 'completed' || !outcome.url) {
      throw new Error(outcome?.error || `Failed to generate ${what}`);
    }
    const { base64, mimeType } = await urlToBase64(outcome.url);
    return { mediaId: outcome.id, base64, mimeType: mimeType || (what === 'video' ? 'video/mp4' : 'image/png') };
  };

  const failed = (what: 'image' | 'video') => (error: unknown): never => {
    showSnack({ icon: 'error', text: `Failed to generate ${what}`, actions: [{ label: 'Dismiss' }], tone: 'error' });
    throw error instanceof Error ? error : new Error(String(error));
  };

  return {
    async generateImage(payload) {
      const h = host();
      const model = matchModelName(payload.modelDisplayName, h.imageModels) ?? h.defaultImageModel;
      try {
        if (!model) throw new Error('No image model is added. Add one in Settings → Models.');
        const references = requireItems(payload.referenceImageMediaIds, 'image');
        return await awaitOne(h.startImages({ prompt: payload.prompt, model, ratio: fitRatio(payload.aspectRatio, '16:9'), count: 1, references }), 'image');
      } catch (error) {
        return failed('image')(error);
      }
    },

    async generateVideo(payload) {
      const h = host();
      const model = matchModelName(payload.modelDisplayName, h.videoModels) ?? h.defaultVideoModel;
      try {
        if (!model) throw new Error('No video model is added. Add one in Settings → Models.');
        const frames = [
          ...requireItems(payload.firstFrameImageMediaId ? [payload.firstFrameImageMediaId] : [], 'image'),
          ...requireItems(payload.lastFrameImageMediaId ? [payload.lastFrameImageMediaId] : [], 'image'),
          ...requireItems(payload.referenceImageMediaIds, 'image'),
        ];
        const duration = `${payload.durationSeconds ?? 8}s`;
        return await awaitOne(h.startVideos({ prompt: payload.prompt, model, ratio: fitRatio(payload.aspectRatio, '16:9'), duration, count: 1, frames }), 'video');
      } catch (error) {
        return failed('video')(error);
      }
    },

    async generateText(payload) {
      const key = host().geminiKeys[0];
      if (!key) throw new Error('Text generation needs a Google Gemini API key. Add one in Settings → Models.');
      const model = getGeminiClient(key).getGenerativeModel({
        model: MEDIA_AGENT_MODEL,
        ...(payload.systemInstruction ? { systemInstruction: payload.systemInstruction } : {}),
        ...(payload.thinkingLevel ? { generationConfig: { thinkingConfig: { thinkingLevel: payload.thinkingLevel } } } : {}),
      } as never);
      const media = [...(payload.images ?? []), ...(payload.videos ?? []), ...(payload.audios ?? [])]
        .map((m) => ({ inlineData: { mimeType: m.mimeType || 'application/octet-stream', data: m.base64 } }));
      const response = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: payload.prompt || ' ' }, ...media] }] });
      return { text: String(response.response.text() ?? '') };
    },

    async saveMedia(file, { announce }) {
      const snack = announce ? showSnack({ icon: 'spinner', text: 'Saving to gallery…', actions: [] }) : null;
      try {
        const ext = file.mimeType.split('/')[1]?.split(/[;+]/)[0] || 'png';
        const name = /\.[a-z0-9]{2,5}$/i.test(file.name) ? file.name : `${file.name}.${ext}`;
        const blob = new Blob([base64ToBytes(file.base64) as BlobPart], { type: file.mimeType });
        const [item] = await host().importFiles([new File([blob], name, { type: file.mimeType })]);
        if (!item) throw new Error('The file could not be added to the project.');
        known.set(item.id, item);
        if (snack !== null) updateSnack(snack, { icon: 'check_circle', text: 'Saved to gallery', actions: [{ label: 'Dismiss' }] });
        return { id: item.id };
      } catch (error) {
        if (snack !== null) updateSnack(snack, { icon: 'error', text: 'Failed to save to gallery', actions: [{ label: 'Dismiss' }], tone: 'error' });
        throw error instanceof Error ? error : new Error(String(error));
      } finally {
        if (snack !== null) window.setTimeout(() => dismissSnack(snack), 4000);
      }
    },

    async selectMedia(request) {
      const picked = await pickMedia(request);
      if (!picked || picked.length === 0) return null;
      const limited = request.multiple && request.maxCount ? picked.slice(0, request.maxCount) : picked;
      return Promise.all(limited.map(async (item) => {
        known.set(item.id, item);
        const { base64, mimeType } = await urlToBase64(item.url || '');
        return { mediaId: item.id, base64, mimeType, type: itemType(item), name: itemName(item) };
      }));
    },

    async mediaBase64(mediaId) {
      const item = findItem(mediaId);
      if (!item?.url) throw new Error(`No media with mediaId ${mediaId} in this project.`);
      return urlToBase64(item.url);
    },

    storage: toolStorage(toolId),

    persistLocalStorage(entries) {
      void saveLocalStorage(toolId, entries).catch((e) => console.warn('[tools] localStorage not saved', e));
    },
  };
}
