import { resolveEndpointTransport, type ProviderId } from './providers/endpoints';
import { apiKeysForBinding, resolveProviderBinding } from './providers/profiles';

export const DEFAULT_TRANSCRIPTION_MODEL = 'gemini-3.5-flash-lite';
/**
 * The browser's own speech recognition (the Web Speech API): Chrome's and Edge's
 * recognizers, Safari's. No API key. The id is Chrome's for the settings saved
 * before other browsers counted; it means "whatever this browser has".
 */
export const CHROME_NATIVE_TRANSCRIPTION_MODEL = 'chrome-native';
export const CHROME_NATIVE_TRANSCRIPTION_NAME = 'Browser speech recognition';
/** Whisper running in the page (WebAssembly), for every browser and webview. No API key. */
export const ON_DEVICE_TRANSCRIPTION_MODEL = 'on-device-whisper';
export const ON_DEVICE_TRANSCRIPTION_NAME = 'On this device (Whisper)';

export const isChromeNativeTranscriptionModel = (modelId: unknown): boolean => (
  modelId === CHROME_NATIVE_TRANSCRIPTION_MODEL
);

export const isOnDeviceTranscriptionModel = (modelId: unknown): boolean => (
  modelId === ON_DEVICE_TRANSCRIPTION_MODEL
);

/**
 * Transcription SKUs that only exist on the Live API.
 *
 * Google ships the 3.5 Transcribe pair across two different APIs: the file model
 * takes recorded audio over Interactions, while `-live` streams PCM over the Live
 * API's WebSocket and has no Interactions or `generateContent` surface at all.
 * This module transcribes a finished recording, so a live-only model can never
 * answer here — it has to be kept out of the picker rather than failing at send.
 */
export const isLiveOnlyTranscriptionModel = (modelId: unknown): boolean => (
  typeof modelId === 'string' && /transcribe-live$/i.test(modelId.trim())
);

type TranscriptionProvider = ProviderId;

/**
 * How a model takes a recording, or null when it can't.
 *
 * - `gemini`: any Gemini model that reads input (every chat model hears audio);
 *   not the image, video, speech-out, embedding or live-only ones.
 * - `openai-transcription`: Whisper and the `*-transcribe` models, which answer on
 *   `/audio/transcriptions` and nowhere else — a chat-completions request with
 *   audio is a 404 for them.
 * - `openai-chat-audio`: the audio chat models (`gpt-4o-audio-preview`,
 *   `gpt-audio`), which take `input_audio` in a chat completion.
 *
 * Anthropic, Moonshot, xAI and Zhipu models take no audio, so none of them can.
 */
export type TranscriptionRoute = 'gemini' | 'openai-transcription' | 'openai-chat-audio';

export const transcriptionRoute = (provider: string, modelId: unknown): TranscriptionRoute | null => {
  if (typeof modelId !== 'string' || !modelId.trim()) return null;
  const id = modelId.trim().toLowerCase();
  if (isChromeNativeTranscriptionModel(id) || isOnDeviceTranscriptionModel(id) || isLiveOnlyTranscriptionModel(id)) return null;
  if (provider === 'gemini') {
    if (/(?:^|[-_.])(?:tts|image|imagen|veo|embedding|embed|lyria|live|native-audio|robotics|computer-use)(?:$|[-_.])/.test(id)) return null;
    return 'gemini';
  }
  if (provider === 'openai') {
    if (/whisper|transcribe/.test(id)) return 'openai-transcription';
    if (/(?:^|[-_])audio(?:$|[-_])|^gpt-audio/.test(id) && !/tts/.test(id)) return 'openai-chat-audio';
  }
  return null;
};

export const canTranscribeAudio = (provider: string, modelId: unknown): boolean => transcriptionRoute(provider, modelId) !== null;

const inferProvider = (modelId: string): TranscriptionProvider => {
  const normalized = modelId.toLowerCase();
  if (normalized.startsWith('gemini-')) return 'gemini';
  if (normalized.startsWith('claude-')) return 'anthropic';
  if (normalized.startsWith('kimi-') || normalized.startsWith('moonshot-')) return 'moonshot';
  if (normalized.startsWith('grok-')) return 'spacexai';
  if (normalized.startsWith('glm-')) return 'zhipuai';
  return 'openai';
};

const PROVIDERS: TranscriptionProvider[] = ['gemini', 'openai', 'anthropic', 'moonshot', 'spacexai', 'zhipuai'];

/** A model that can transcribe a recording, with the profile it was saved under. */
export interface TranscriptionCandidate {
  provider: TranscriptionProvider;
  modelId: string;
  name: string;
  savedModel?: { profileId?: string } | null;
}

interface SavedModelLike { id?: string; modelId?: string; name?: string; profileId?: string }

const savedModelsOf = (modelConfig: any, provider: TranscriptionProvider): SavedModelLike[] => (
  Array.isArray(modelConfig?.[provider]?.savedModels) ? modelConfig[provider].savedModels : []
);

const findSaved = (modelConfig: any, selectedId: string): TranscriptionCandidate | null => {
  for (const provider of PROVIDERS) {
    const saved = savedModelsOf(modelConfig, provider).find((model) => model.modelId === selectedId || model.id === selectedId);
    if (saved) return { provider, modelId: saved.modelId || saved.id || selectedId, name: saved.name || selectedId, savedModel: saved };
    if (modelConfig?.[provider]?.model === selectedId) return { provider, modelId: selectedId, name: selectedId };
  }
  return null;
};

/** The keys a candidate may use, in order: its profile's bucket, then a legacy per-provider key. */
export const transcriptionKeys = (modelConfig: any, apiKeys: unknown, candidate: TranscriptionCandidate): string[] => {
  const binding = resolveProviderBinding(modelConfig, candidate.provider, candidate.savedModel);
  const keys = apiKeysForBinding(binding, candidate.provider, apiKeys);
  const legacy = typeof modelConfig?.[candidate.provider]?.apiKey === 'string' ? modelConfig[candidate.provider].apiKey.trim() : '';
  return keys.length ? keys : legacy ? [legacy] : [];
};

/**
 * The selected transcription model, when it is an API model: null for the browser's
 * recognizer, on-device Whisper, or nothing chosen. A selection that can't take
 * audio (a chat model with no ears) is returned too, so the caller can say why.
 */
export const selectedTranscriptionCandidate = (modelConfig: any): TranscriptionCandidate | null => {
  const selectedId = modelConfig?.systemDefaults?.transcription;
  if (typeof selectedId !== 'string' || !selectedId.trim()) return null;
  if (isChromeNativeTranscriptionModel(selectedId) || isOnDeviceTranscriptionModel(selectedId)) return null;
  return findSaved(modelConfig, selectedId) || { provider: inferProvider(selectedId), modelId: selectedId, name: selectedId };
};

/** The cheapest Gemini model saved for chat reads audio as well as any; failing that, the default. */
const geminiPreference = (model: SavedModelLike) => {
  const id = (model.modelId || model.id || '').toLowerCase();
  if (id.includes('flash-lite') || id.includes('flash lite')) return 0;
  if (id.includes('flash')) return 1;
  return 2;
};

/**
 * Every model that could transcribe a recording with the keys at hand, best first:
 * the selected one when it can take audio, then a saved Gemini model (the default
 * flash-lite when none is saved), then OpenAI's transcription models. What a take
 * falls back to when its first route fails.
 */
export const transcriptionCandidates = (modelConfig: any, apiKeys: unknown): TranscriptionCandidate[] => {
  const out: TranscriptionCandidate[] = [];
  const seen = new Set<string>();
  const push = (candidate: TranscriptionCandidate | null) => {
    if (!candidate || !canTranscribeAudio(candidate.provider, candidate.modelId)) return;
    const key = `${candidate.provider}:${candidate.modelId}`;
    if (seen.has(key) || !transcriptionKeys(modelConfig, apiKeys, candidate).length) return;
    seen.add(key);
    out.push(candidate);
  };
  push(selectedTranscriptionCandidate(modelConfig));
  const gemini = savedModelsOf(modelConfig, 'gemini')
    .filter((model) => canTranscribeAudio('gemini', model.modelId || model.id))
    .sort((a, b) => geminiPreference(a) - geminiPreference(b));
  gemini.forEach((model) => push({ provider: 'gemini', modelId: model.modelId || model.id || '', name: model.name || '', savedModel: model }));
  push({ provider: 'gemini', modelId: DEFAULT_TRANSCRIPTION_MODEL, name: 'Gemini 3.5 Flash Lite' });
  savedModelsOf(modelConfig, 'openai')
    .filter((model) => canTranscribeAudio('openai', model.modelId || model.id))
    .forEach((model) => push({ provider: 'openai', modelId: model.modelId || model.id || '', name: model.name || '', savedModel: model }));
  push({ provider: 'openai', modelId: 'gpt-4o-mini-transcribe', name: 'GPT-4o mini Transcribe' });
  return out;
};

interface ResolvedTranscriptionModel {
  provider: TranscriptionProvider;
  route: TranscriptionRoute;
  modelId: string;
  apiKey: string;
  baseUrl?: string;
}

const resolveCandidate = (modelConfig: any, apiKeys: unknown, candidate: TranscriptionCandidate): ResolvedTranscriptionModel => {
  const route = transcriptionRoute(candidate.provider, candidate.modelId);
  if (!route) {
    throw new Error(`${candidate.name || candidate.modelId} can't transcribe audio. Choose a Gemini model, an OpenAI transcription model, or the browser in Settings > Models & API.`);
  }
  const [apiKey] = transcriptionKeys(modelConfig, apiKeys, candidate);
  if (!apiKey) {
    throw new Error(`Add an API key for ${candidate.name || candidate.modelId} in Settings > Models & API.`);
  }
  const binding = resolveProviderBinding(modelConfig, candidate.provider, candidate.savedModel);
  return { provider: candidate.provider, route, modelId: candidate.modelId, apiKey, baseUrl: binding.baseUrl };
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const blobToBase64 = async (blob: Blob) => bytesToBase64(new Uint8Array(await blob.arrayBuffer()));

const writeAscii = (view: DataView, offset: number, value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
};

const audioBufferToWav = (audioBuffer: AudioBuffer) => {
  const channelCount = Math.max(1, Math.min(2, audioBuffer.numberOfChannels));
  const frameCount = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const wav = new ArrayBuffer(44 + frameCount * blockAlign);
  const view = new DataView(wav);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + frameCount * blockAlign, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, audioBuffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, frameCount * blockAlign, true);

  const channels = Array.from(
    { length: channelCount },
    (_, channel) => audioBuffer.getChannelData(channel),
  );
  let writeOffset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel][frame] || 0));
      view.setInt16(
        writeOffset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true,
      );
      writeOffset += bytesPerSample;
    }
  }

  return new Blob([wav], { type: 'audio/wav' });
};

const convertToWav = async (audio: Blob) => {
  const AudioContextConstructor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextConstructor) return audio;

  const context = new AudioContextConstructor();
  try {
    const decoded = await context.decodeAudioData((await audio.arrayBuffer()).slice(0));
    return audioBufferToWav(decoded);
  } finally {
    await context.close().catch(() => undefined);
  }
};

const cleanTranscript = (value: string) => {
  let transcript = value.trim();
  if (transcript.startsWith('```') && transcript.endsWith('```')) {
    transcript = transcript.replace(/^```(?:text)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  return transcript.replace(/^transcript\s*:\s*/i, '').trim();
};

const responseError = async (response: Response) => {
  const data = await response.json().catch(() => null);
  return data?.error?.message || data?.message || `Transcription failed (${response.status}).`;
};

/**
 * Text out of one `generateContent` part.
 *
 * The transcribe SKUs answer with `audioTranscription.text` rather than the
 * `text` every other Gemini model uses, so a reader that only knows `text`
 * silently returns "" for the one model family this file exists to support.
 */
const partText = (part: any): string => (
  (typeof part?.text === 'string' ? part.text : '')
  || (typeof part?.audioTranscription?.text === 'string' ? part.audioTranscription.text : '')
);

/** Flattens a `content`/`outputs` array of typed blocks (or a bare string) to text. */
const contentBlocksText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block: any) => (typeof block === 'string' ? block : partText(block)))
    .filter(Boolean)
    .join('\n');
};

const stepText = (step: any): string => {
  if (typeof step?.output_text === 'string' && step.output_text.trim()) return step.output_text;
  if (typeof step?.text === 'string' && step.text.trim()) return step.text;
  const content = contentBlocksText(step?.content);
  if (content.trim()) return content;
  return contentBlocksText(step?.outputs);
};

const extractInteractionTranscript = (data: any): string => {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return cleanTranscript(data.output_text);
  }
  if (typeof data?.text === 'string' && data.text.trim()) {
    return cleanTranscript(data.text);
  }
  const outputs = contentBlocksText(data?.outputs);
  if (outputs.trim()) return cleanTranscript(outputs);

  if (Array.isArray(data?.steps)) {
    /*
     * Where the transcript actually is.
     *
     * A completed interaction returns `steps: [{ type: 'model_output', content:
     * [{ type: 'text', text }] }]` — the text is nested inside the step's
     * `content` blocks, not on the step itself. Every `model_output` step is
     * concatenated rather than taking the last one, so a transcript split across
     * steps is not silently truncated to its final chunk.
     */
    const modelOutput = data.steps
      .filter((step: any) => step?.type === 'model_output')
      .map(stepText)
      .filter(Boolean)
      .join('\n');
    if (modelOutput.trim()) return cleanTranscript(modelOutput);

    for (let i = data.steps.length - 1; i >= 0; i--) {
      const text = stepText(data.steps[i]);
      if (text.trim()) return cleanTranscript(text);
    }
  }
  if (Array.isArray(data?.candidates?.[0]?.content?.parts)) {
    const text = data.candidates[0].content.parts.map(partText).join('');
    if (text.trim()) return cleanTranscript(text);
  }
  return '';
};

/** Where a Gemini request goes: the official API, or a custom gateway (through the dev proxy). */
const geminiTransport = (model: ResolvedTranscriptionModel) => {
  const transport = resolveEndpointTransport('gemini', model.baseUrl, 'origin');
  return { origin: transport.url.replace(/\/+$/, ''), headers: transport.headers ?? {} };
};

const uploadFileToGemini = async (
  audio: Blob,
  model: ResolvedTranscriptionModel,
  signal?: AbortSignal,
): Promise<string> => {
  const { origin, headers } = geminiTransport(model);
  const mimeType = (audio.type || 'audio/wav').split(';')[0].trim();
  const size = audio.size;

  const initRes = await fetch(
    `${origin}/upload/v1beta/files?key=${encodeURIComponent(model.apiKey)}`,
    {
      method: 'POST',
      headers: {
        ...headers,
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(size),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: 'dictation_audio' } }),
      signal,
    },
  );

  if (!initRes.ok) {
    throw new Error(await responseError(initRes));
  }

  const uploadUrl = initRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) {
    throw new Error('Gemini Files API upload URL not found in response.');
  }

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(size),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: audio,
    signal,
  });

  if (!uploadRes.ok) {
    throw new Error(await responseError(uploadRes));
  }

  const uploadData = await uploadRes.json();
  const uri = uploadData?.file?.uri;
  if (!uri) {
    throw new Error('Gemini Files API did not return file URI.');
  }
  return uri;
};

const transcribeWithGemini = async (
  audio: Blob,
  model: ResolvedTranscriptionModel,
  language: string | undefined,
  signal?: AbortSignal,
) => {
  const { origin, headers } = geminiTransport(model);
  const wavAudio = await convertToWav(audio).catch(() => audio);
  const mimeType = (wavAudio.type || audio.type || 'audio/wav').split(';')[0].trim();
  const audioData = await blobToBase64(wavAudio);
  /*
   * Why the fallback chain remembers its first error.
   *
   * Each attempt below gives up quietly so the next one can run, which is right
   * — but it used to discard the reason as well, so a chain that failed at every
   * step surfaced as an empty transcript and the composer said "Didn't catch
   * that", blaming the microphone for what was an API error. The first real
   * reason is kept and raised if nothing produces a transcript.
   */
  let firstFailure = '';
  const noteFailure = (reason: unknown) => {
    if (firstFailure) return;
    const message = reason instanceof Error ? reason.message : String(reason ?? '');
    if (message) firstFailure = message;
  };

  // Specialized transcribe models (gemini-3.5-transcribe, etc.) use the Interactions API
  if (model.modelId.includes('transcribe')) {
    // 1. Try Interactions API with inline audio
    try {
      const response = await fetch(
        `${origin}/v1beta/interactions?key=${encodeURIComponent(model.apiKey)}`,
        {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json',
            'x-goog-api-key': model.apiKey,
          },
          signal,
          body: JSON.stringify({
            model: model.modelId,
            input: [
              {
                type: 'audio',
                data: audioData,
                mime_type: mimeType,
              },
            ],
          }),
        },
      );

      if (response.ok) {
        const data = await response.json();
        const transcript = extractInteractionTranscript(data);
        if (transcript) return transcript;
      } else {
        noteFailure(await responseError(response));
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      noteFailure(error);
      // Fall through to Files API
    }

    // 2. Try Interactions API via Files API upload
    try {
      const fileUri = await uploadFileToGemini(wavAudio, model, signal);
      const fileResponse = await fetch(
        `${origin}/v1beta/interactions?key=${encodeURIComponent(model.apiKey)}`,
        {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json',
            'x-goog-api-key': model.apiKey,
          },
          signal,
          body: JSON.stringify({
            model: model.modelId,
            input: [
              {
                type: 'audio',
                uri: fileUri,
                mime_type: mimeType,
              },
            ],
          }),
        },
      );

      if (fileResponse.ok) {
        const data = await fileResponse.json();
        const transcript = extractInteractionTranscript(data);
        if (transcript) return transcript;
      } else {
        noteFailure(await responseError(fileResponse));
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      noteFailure(error);
      // Fall through to generateContent
    }
  }

  // Standard generateContent endpoint
  const response = await fetch(
    `${origin}/v1beta/models/${encodeURIComponent(model.modelId)}:generateContent?key=${encodeURIComponent(model.apiKey)}`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            {
              text: `Transcribe this audio exactly${language ? ` (the speaker's language is most likely ${language})` : ''}. Preserve the spoken language, wording, punctuation, and line breaks where natural. Return only the transcript, or nothing if no one speaks.`,
            },
            {
              inlineData: {
                mimeType,
                data: audioData,
              },
            },
          ],
        }],
        generationConfig: { temperature: 0 },
      }),
    },
  );

  if (!response.ok) throw new Error(await responseError(response));
  const data = await response.json();
  const transcript = (data?.candidates?.[0]?.content?.parts || [])
    .map(partText)
    .join('');
  if (!transcript.trim() && firstFailure) throw new Error(firstFailure);
  return cleanTranscript(transcript);
};

/** Where an OpenAI request goes: the official API, or a custom gateway (through the dev proxy). */
const openAITransport = (model: ResolvedTranscriptionModel) => {
  const transport = resolveEndpointTransport('openai', model.baseUrl, 'v1');
  return { base: transport.url.replace(/\/+$/, ''), headers: transport.headers ?? {} };
};

const extensionFor = (mimeType: string) => {
  const type = mimeType.split(';')[0].trim();
  if (type === 'audio/webm' || type === 'video/webm') return 'webm';
  if (type === 'audio/mp4' || type === 'video/mp4') return 'mp4';
  if (type === 'audio/ogg') return 'ogg';
  if (type === 'audio/mpeg') return 'mp3';
  if (type === 'audio/wav' || type === 'audio/x-wav') return 'wav';
  return 'webm';
};

/** Whisper and the `*-transcribe` models: the recording as a file on `/audio/transcriptions`. */
const transcribeWithOpenAITranscriptions = async (
  audio: Blob,
  model: ResolvedTranscriptionModel,
  language: string | undefined,
  signal?: AbortSignal,
) => {
  const { base, headers } = openAITransport(model);
  const mimeType = audio.type || 'audio/webm';
  const form = new FormData();
  form.append('file', new File([audio], `dictation.${extensionFor(mimeType)}`, { type: mimeType.split(';')[0] }));
  form.append('model', model.modelId);
  form.append('response_format', 'json');
  if (language) form.append('language', language);
  const response = await fetch(`${base}/audio/transcriptions`, {
    method: 'POST',
    headers: { ...headers, Authorization: `Bearer ${model.apiKey}` },
    body: form,
    signal,
  });
  if (!response.ok) throw new Error(await responseError(response));
  const data = await response.json().catch(() => null);
  return cleanTranscript(typeof data?.text === 'string' ? data.text : '');
};

/** The audio chat models: the recording as `input_audio` in a chat completion. */
const transcribeWithOpenAIChatAudio = async (
  audio: Blob,
  model: ResolvedTranscriptionModel,
  signal?: AbortSignal,
) => {
  const { base, headers } = openAITransport(model);
  const wavAudio = await convertToWav(audio).catch(() => audio);
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey}` },
    signal,
    body: JSON.stringify({
      model: model.modelId,
      modalities: ['text'],
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Transcribe this audio exactly. Return only the transcript, or nothing if no one speaks.' },
          { type: 'input_audio', input_audio: { data: await blobToBase64(wavAudio), format: wavAudio.type === 'audio/wav' ? 'wav' : 'mp3' } },
        ],
      }],
    }),
  });
  if (!response.ok) throw new Error(await responseError(response));
  const data = await response.json();
  const content: unknown = data?.choices?.[0]?.message?.content;
  const transcript = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part: any) => part?.text || '').join('')
      : '';
  return cleanTranscript(transcript);
};

interface TranscriptionRequest {
  audio: Blob;
  apiKeys: unknown;
  modelConfig: any;
  signal?: AbortSignal;
  /** Which model to use; the selected one when omitted. */
  candidate?: TranscriptionCandidate;
  /** A BCP 47 language hint (`en`, `hi`), when the caller knows one. */
  language?: string;
}

export const transcribeRecordedAudio = async ({
  audio,
  apiKeys,
  modelConfig,
  signal,
  candidate,
  language,
}: TranscriptionRequest) => {
  const chosen = candidate || selectedTranscriptionCandidate(modelConfig)
    || { provider: 'gemini' as const, modelId: DEFAULT_TRANSCRIPTION_MODEL, name: 'Gemini 3.5 Flash Lite' };
  const model = resolveCandidate(modelConfig, apiKeys, chosen);
  const hint = language?.split('-')[0]?.toLowerCase() || undefined;
  if (model.route === 'gemini') return transcribeWithGemini(audio, model, hint, signal);
  if (model.route === 'openai-transcription') return transcribeWithOpenAITranscriptions(audio, model, hint, signal);
  return transcribeWithOpenAIChatAudio(audio, model, signal);
};
