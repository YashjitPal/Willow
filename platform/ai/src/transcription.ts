import OpenAI from 'openai';

export const DEFAULT_TRANSCRIPTION_MODEL = 'gemini-3.5-flash-lite';
/** Browser-provided speech recognition. It does not require a Willow/provider API key. */
export const CHROME_NATIVE_TRANSCRIPTION_MODEL = 'chrome-native';
export const CHROME_NATIVE_TRANSCRIPTION_NAME = 'Chrome on-device';

export const isChromeNativeTranscriptionModel = (modelId: unknown): boolean => (
  modelId === CHROME_NATIVE_TRANSCRIPTION_MODEL
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

const transcribeWithGemini = async (
  audio: Blob,
  model: ResolvedTranscriptionModel,
  signal?: AbortSignal,
) => {
  const audioData = await blobToBase64(audio);
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
                mimeType: audio.type || 'audio/webm',
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
    .map((part: any) => part?.text || '')
    .join('');
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
