import OpenAI from 'openai';

export const DEFAULT_TRANSCRIPTION_MODEL = 'gemini-3.5-flash-lite';
/** Browser-provided speech recognition. It does not require a Willow/provider API key. */
export const CHROME_NATIVE_TRANSCRIPTION_MODEL = 'chrome-native';
export const CHROME_NATIVE_TRANSCRIPTION_NAME = 'Chrome on-device';

export const isChromeNativeTranscriptionModel = (modelId: unknown): boolean => (
  modelId === CHROME_NATIVE_TRANSCRIPTION_MODEL
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

type TranscriptionProvider =
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'moonshot'
  | 'spacexai'
  | 'zhipuai';

interface TranscriptionRequest {
  audio: Blob;
  apiKeys: TranscriptionApiKeys;
  modelConfig: any;
  signal?: AbortSignal;
}

interface TranscriptionApiKeys {
  gemini?: string[];
  openai?: string[];
  anthropic?: string[];
  moonshot?: string[];
  spacexai?: string[];
  zhipuai?: string[];
}

interface ResolvedTranscriptionModel {
  provider: TranscriptionProvider;
  modelId: string;
  apiKey: string;
  baseUrl?: string;
}

const PROVIDERS: TranscriptionProvider[] = [
  'gemini',
  'openai',
  'anthropic',
  'moonshot',
  'spacexai',
  'zhipuai',
];

const DEFAULT_BASE_URLS: Partial<Record<TranscriptionProvider, string>> = {
  openai: 'https://api.openai.com/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  spacexai: 'https://api.x.ai/v1',
  zhipuai: 'https://open.bigmodel.cn/api/paas/v4',
};

const firstApiKey = (keys?: string[]) => keys?.find((key) => key.trim())?.trim() || '';

const inferProvider = (modelId: string): TranscriptionProvider => {
  const normalized = modelId.toLowerCase();
  if (normalized.startsWith('gemini-')) return 'gemini';
  if (normalized.startsWith('claude-')) return 'anthropic';
  if (normalized.startsWith('kimi-') || normalized.startsWith('moonshot-')) return 'moonshot';
  if (normalized.startsWith('grok-')) return 'spacexai';
  if (normalized.startsWith('glm-')) return 'zhipuai';
  return 'openai';
};

const resolveTranscriptionModel = (
  modelConfig: any,
  apiKeys: TranscriptionApiKeys,
): ResolvedTranscriptionModel => {
  const selectedId = modelConfig?.systemDefaults?.transcription || DEFAULT_TRANSCRIPTION_MODEL;
  let provider: TranscriptionProvider | undefined;
  let modelId = selectedId;

  for (const candidateProvider of PROVIDERS) {
    const providerConfig = modelConfig?.[candidateProvider];
    const savedModel = (providerConfig?.savedModels || []).find(
      (model: any) => model.modelId === selectedId || model.id === selectedId,
    );
    if (savedModel) {
      provider = candidateProvider;
      modelId = savedModel.modelId || savedModel.id;
      break;
    }

    if (providerConfig?.model === selectedId) {
      provider = candidateProvider;
      break;
    }
  }

  provider ||= inferProvider(modelId);
  const apiKey = firstApiKey(apiKeys?.[provider]) || modelConfig?.[provider]?.apiKey?.trim?.() || '';

  if (!apiKey) {
    throw new Error(`Add an API key for the selected transcription model in Settings > Models & API.`);
  }

  return {
    provider,
    modelId,
    apiKey,
    baseUrl: modelConfig?.[provider]?.baseUrl || DEFAULT_BASE_URLS[provider],
  };
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

const uploadFileToGemini = async (
  audio: Blob,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> => {
  const mimeType = (audio.type || 'audio/wav').split(';')[0].trim();
  const size = audio.size;

  const initRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
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
  signal?: AbortSignal,
) => {
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
        `https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(model.apiKey)}`,
        {
          method: 'POST',
          headers: {
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
      noteFailure(error);
      // Fall through to Files API
    }

    // 2. Try Interactions API via Files API upload
    try {
      const fileUri = await uploadFileToGemini(wavAudio, model.apiKey, signal);
      const fileResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(model.apiKey)}`,
        {
          method: 'POST',
          headers: {
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
      noteFailure(error);
      // Fall through to generateContent
    }
  }

  // Standard generateContent endpoint
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.modelId)}:generateContent?key=${encodeURIComponent(model.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            {
              text: 'Transcribe this audio exactly. Preserve the spoken language, wording, punctuation, and line breaks where natural. Return only the transcript.',
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

const transcribeWithOpenAICompatible = async (
  audio: Blob,
  model: ResolvedTranscriptionModel,
  signal?: AbortSignal,
) => {
  const wavAudio = await convertToWav(audio).catch(() => audio);
  const audioData = await blobToBase64(wavAudio);
  const isDevelopment = typeof window !== 'undefined'
    && (window.location.hostname === 'localhost'
      || window.location.hostname === '127.0.0.1'
      || window.location.port === '3000');
  const useDynamicProxy = model.provider !== 'openai' && isDevelopment;
  const baseURL = useDynamicProxy
    ? `${window.location.origin}/llm-proxy`
    : model.baseUrl;

  const client = new OpenAI({
    apiKey: model.apiKey,
    baseURL,
    dangerouslyAllowBrowser: true,
    defaultHeaders: useDynamicProxy && model.baseUrl
      ? { 'x-proxy-target': model.baseUrl }
      : undefined,
  });

  const response = await client.chat.completions.create({
    model: model.modelId,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Transcribe this audio exactly. Return only the transcript.',
        },
        {
          type: 'input_audio',
          input_audio: {
            data: audioData,
            format: wavAudio.type === 'audio/wav' ? 'wav' : 'webm',
          },
        },
      ],
    }],
  } as any, signal ? { signal } : undefined);

  const content: unknown = response.choices?.[0]?.message?.content;
  const transcript = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part: any) => part?.text || '').join('')
      : '';
  return cleanTranscript(transcript);
};

export const transcribeRecordedAudio = async ({
  audio,
  apiKeys,
  modelConfig,
  signal,
}: TranscriptionRequest) => {
  const model = resolveTranscriptionModel(modelConfig, apiKeys);

  if (model.provider === 'gemini') {
    return transcribeWithGemini(audio, model, signal);
  }

  if (model.provider === 'anthropic') {
    throw new Error('The selected Anthropic model does not accept recorded audio. Choose an audio-capable model for transcription.');
  }

  return transcribeWithOpenAICompatible(audio, model, signal);
};
