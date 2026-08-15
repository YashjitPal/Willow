import { resolveEndpointTransport } from './providers/endpoints';

export type EmbeddingTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

export interface GeminiEmbeddingInput {
  apiKey: string;
  baseUrl?: string;
  modelId: string;
  text: string;
  taskType: EmbeddingTaskType;
  title?: string;
  outputDimensionality?: number;
  signal?: AbortSignal;
}

export interface GeminiEmbeddingBatchInput {
  apiKey: string;
  baseUrl?: string;
  modelId: string;
  items: Array<Pick<GeminiEmbeddingInput, 'text' | 'taskType' | 'title'>>;
  outputDimensionality?: number;
  signal?: AbortSignal;
}

interface GeminiEmbeddingResponse {
  embedding?: {
    values?: unknown;
  };
}

interface GeminiBatchEmbeddingResponse {
  embeddings?: Array<{ values?: unknown }>;
}

const buildEmbeddingUrl = (baseUrl: string, modelId: string): string => {
  const normalized = baseUrl.replace(/\/+$/, '').replace(/\/v1(beta)?$/, '');
  return `${normalized}/v1beta/models/${encodeURIComponent(modelId)}:embedContent`;
};

const validateEmbeddingValues = (value: unknown): number[] => {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'number')) {
    throw new Error('Gemini embedding response did not contain a numeric vector');
  }
  return value as number[];
};

/** Embed multiple documents in one Gemini batch request. */
export async function embedGeminiTexts({
  apiKey,
  baseUrl,
  modelId,
  items,
  outputDimensionality = 768,
  signal,
}: GeminiEmbeddingBatchInput): Promise<number[][]> {
  if (items.length === 0) return [];
  const transport = resolveEndpointTransport('gemini', baseUrl, 'origin');
  const response = await fetch(buildEmbeddingUrl(transport.url, modelId).replace(':embedContent', ':batchEmbedContents'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
      ...(transport.headers || {}),
    },
    body: JSON.stringify({
      requests: items.map((item) => ({
        model: `models/${modelId}`,
        content: { parts: [{ text: item.text }] },
        taskType: item.taskType,
        ...(item.taskType === 'RETRIEVAL_DOCUMENT' && item.title ? { title: item.title } : {}),
        outputDimensionality,
      })),
    }),
    signal,
  });

  if (!response.ok) throw new Error(`Gemini embedding batch request failed (${response.status})`);
  const payload = await response.json() as GeminiBatchEmbeddingResponse;
  if (!Array.isArray(payload.embeddings) || payload.embeddings.length !== items.length) {
    throw new Error('Gemini embedding batch response had an unexpected length');
  }
  return payload.embeddings.map((embedding) => validateEmbeddingValues(embedding.values));
}

/** Embed text with Gemini without exposing the user's key in the URL. */
export async function embedGeminiText({
  apiKey,
  baseUrl,
  modelId,
  text,
  taskType,
  title,
  outputDimensionality = 768,
  signal,
}: GeminiEmbeddingInput): Promise<number[]> {
  const transport = resolveEndpointTransport('gemini', baseUrl, 'origin');
  const response = await fetch(buildEmbeddingUrl(transport.url, modelId), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
      ...(transport.headers || {}),
    },
    body: JSON.stringify({
      model: `models/${modelId}`,
      content: { parts: [{ text }] },
      taskType,
      ...(taskType === 'RETRIEVAL_DOCUMENT' && title ? { title } : {}),
      outputDimensionality,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Gemini embedding request failed (${response.status})`);
  }

  const payload = await response.json() as GeminiEmbeddingResponse;
  return validateEmbeddingValues(payload.embedding?.values);
}
