import type { JsonObject, JsonSchema } from '../domain/types.ts';
import type { ModelTokenLimits } from '../domain/modelCapabilities.ts';

/** Tool definition surfaced to the model. */
export interface LLMToolDef {
  name: string;
  description?: string;
  /** JSON schema for the arguments object. */
  parameters?: JsonSchema;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: JsonObject;
}

export type LLMInputAttachmentKind = 'image' | 'audio' | 'video';
export type ModelInputModality = 'text' | LLMInputAttachmentKind;

export interface LLMInputAttachment {
  name: string;
  mimeType: string;
  dataBase64: string;
  kind?: LLMInputAttachmentKind;
}

export type LLMMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; attachments?: LLMInputAttachment[] }
  | { role: 'assistant'; content: string; toolCalls?: LLMToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; name: string };

export interface LLMRequest {
  model: string;
  messages: LLMMessage[];
  tools?: LLMToolDef[];
  toolChoice?: 'auto' | 'required' | 'none' | { name: string };
  parallelToolCalls?: boolean;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  promptCache?: import('../domain/types.ts').PromptCacheConfig;
  /** minimal | low | medium | high */
  reasoningEffort?: string;
  /** OpenAI Responses text verbosity (gpt-5 family). */
  verbosity?: 'low' | 'medium' | 'high';
  /** Structured output. */
  jsonSchema?: { name: string; schema: JsonSchema };
  /** Streaming text callback (providers may ignore, e.g. when tools force non-streaming). */
  onDelta?: (delta: string) => void;
  abortSignal?: AbortSignal;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  /** Explicitly distinguishes authoritative zero usage from missing provider usage. */
  tokenStatus?: 'reported' | 'not_reported';
  /** Input tokens served from a provider prompt cache (included in inputTokens). */
  cachedInputTokens?: number;
  /** Input tokens written to a provider prompt cache (included in inputTokens). */
  cacheWriteInputTokens?: number;
  /** Hidden/thinking tokens (included in outputTokens when the provider bills them there). */
  reasoningTokens?: number;
  /** Provider-returned model id. Falls back to the requested model. */
  model?: string;
  provider?: 'gemini' | 'openai' | 'anthropic' | 'grok' | 'kimi' | 'glm' | 'mock';
}

export interface LLMResponse {
  text: string;
  toolCalls: LLMToolCall[];
  usage: LLMUsage;
  finishReason?: string;
}

export interface LLMProvider {
  id: 'gemini' | 'openai' | 'anthropic' | 'grok' | 'kimi' | 'glm' | 'mock';
  /** Final provider JSON envelope, used for conservative preflight sizing. */
  prepareRequestBody(req: LLMRequest): JsonObject;
  chat(req: LLMRequest, apiKey: string): Promise<LLMResponse>;
  listModels(apiKey: string): Promise<Array<{ id: string; displayName: string; description?: string; inputModalities: ModelInputModality[] } & ModelTokenLimits>>;
}

export class ProviderError extends Error {
  status?: number;
  provider: string;
  constructor(provider: string, message: string, status?: number) {
    super(`[${provider}] ${message}`);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
  }
}

export function inputModalitiesForModel(provider: LLMProvider['id'], model: string): ModelInputModality[] {
  const id = model.toLowerCase().replace(/^models\//, '');
  if (provider === 'gemini') {
    if (/^gemini-(?:1\.5|2(?:\.|-)|[3-9])/.test(id)) return ['text', 'image', 'audio', 'video'];
    if (id.includes('vision')) return ['text', 'image'];
    return ['text'];
  }
  if (provider === 'openai') {
    return /^(?:gpt-(?:4o|4\.1|5)|chatgpt|o1|o3|o4)/.test(id) ? ['text', 'image'] : ['text'];
  }
  if (provider === 'anthropic') {
    return /^claude-(?:3|[4-9]|(?:sonnet|opus|haiku)-[4-9])/.test(id) ? ['text', 'image'] : ['text'];
  }
  if (provider === 'grok') return /^grok-/.test(id) ? ['text'] : ['text'];
  if (provider === 'kimi') return /^kimi-|^moonshot-/.test(id) ? ['text'] : ['text'];
  if (provider === 'glm') return /^glm-|^chatglm-/.test(id) ? ['text'] : ['text'];
  return ['text'];
}

export function unsupportedInputAttachmentKinds(provider: LLMProvider['id'], model: string, messages: LLMMessage[]): string[] {
  const supported = new Set(inputModalitiesForModel(provider, model));
  const attachments = messages.flatMap((message) => message.role === 'user' ? message.attachments ?? [] : []);
  return [...new Set(attachments
    .map((attachment) => attachment.kind
      ?? (attachment.mimeType.startsWith('image/') ? 'image'
        : attachment.mimeType.startsWith('audio/') ? 'audio'
          : attachment.mimeType.startsWith('video/') ? 'video'
            : 'binary'))
    .filter((kind) => kind === 'binary' || !supported.has(kind as ModelInputModality)))];
}

export function assertInputAttachmentSupport(provider: LLMProvider['id'], model: string, messages: LLMMessage[]): void {
  const unsupported = unsupportedInputAttachmentKinds(provider, model, messages);
  if (unsupported.length === 0) return;
  const modalities = unsupported.join(' and ');
  const imagesOnly = unsupported.every((kind) => kind === 'image');
  const guidance = provider === 'openai' && imagesOnly
    ? 'select a vision-capable OpenAI model such as GPT-4o, GPT-4.1, or GPT-5'
    : provider === 'anthropic' && imagesOnly
      ? 'select Claude 3 or newer for image input'
      : provider === 'gemini'
        ? 'select Gemini 1.5 or newer for image, audio, and video input'
        : provider === 'openai'
          ? 'the Responses adapter accepts image input only; use a Gemini multimodal model for inline audio or video'
          : provider === 'anthropic'
            ? 'the Messages adapter accepts image input only; use a Gemini multimodal model for inline audio or video'
            : 'use a provider-backed multimodal model for binary media input';
  throw new ProviderError(provider, `model '${model}' does not support ${modalities} attachments in this provider API; ${guidance}`);
}

export type ProviderId = LLMProvider['id'];
export type FetchTransport = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Return the provider encoded by a supported model id, or undefined when it is unverified. */
export function providerForKnownModel(model: string): ProviderId | undefined {
  const m = model.toLowerCase().replace(/^models\//, '');
  if (m.startsWith('mock/') || m === 'mock') return 'mock';
  if (m.startsWith('gemini-')) return 'gemini';
  if (
    m.startsWith('gpt-') ||
    /^(?:o1|o3|o4)(?:-|$)/.test(m) ||
    m.startsWith('chatgpt-')
  ) return 'openai';
  if (m.startsWith('claude-')) return 'anthropic';
  if (m.startsWith('grok-')) return 'grok';
  if (m.startsWith('kimi-') || m.startsWith('moonshot-')) return 'kimi';
  if (m.startsWith('glm-') || m.startsWith('chatglm-')) return 'glm';
  return undefined;
}

export class UnknownModelError extends Error {
  readonly model: string;
  constructor(model: string) {
    super(`Unknown model '${model}'. Select a model returned by the model catalog; Willow will not guess its provider.`);
    this.name = 'UnknownModelError';
    this.model = model;
  }
}

/** Route a verified model id to its provider without guessing. */
export function providerForModel(model: string): ProviderId {
  const provider = providerForKnownModel(model);
  if (!provider) throw new UnknownModelError(model);
  return provider;
}

/**
 * fetch with retry on 429/5xx. The timeout bounds the CONNECT/headers phase
 * only — once a response starts streaming (SSE), it is not killed by the
 * timeout; the caller's abort signal still applies end-to-end.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit & { timeoutMs?: number },
  provider: string,
  retries = 2,
  transport: FetchTransport = globalThis.fetch,
): Promise<Response> {
  const timeoutMs = init.timeoutMs ?? 120_000;
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const onCallerAbort = () => ctrl.abort(new ProviderError(provider, 'request aborted'));
    const callerSignal = init.signal as AbortSignal | undefined | null;
    if (callerSignal) {
      if (callerSignal.aborted) throw new ProviderError(provider, 'request aborted');
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
    const headerTimer = setTimeout(
      () => ctrl.abort(new ProviderError(provider, `no response within ${timeoutMs}ms`)),
      timeoutMs,
    );
    headerTimer.unref?.();

    try {
      const res = await transport(url, { ...init, signal: ctrl.signal });
      clearTimeout(headerTimer); // headers received — let the body stream freely
      if (res.status === 429 || res.status >= 500) {
        if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
        const body = await res.text().catch(() => '');
        lastErr = new ProviderError(
          provider,
          `HTTP ${res.status}: ${body.slice(0, 500)}`,
          res.status,
        );
        if (attempt < retries) {
          const retryAfter = Number(res.headers.get('retry-after'));
          const delay = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 30_000)
            : 750 * 2 ** attempt;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw lastErr;
      }
      // Keep the caller-abort listener attached for the response's lifetime
      // so aborting the run also tears down a streaming body.
      return res;
    } catch (e) {
      clearTimeout(headerTimer);
      if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
      const reason = ctrl.signal.aborted ? ctrl.signal.reason : undefined;
      if (reason instanceof ProviderError) {
        if (callerSignal?.aborted) throw reason; // caller abort: no retry
        lastErr = reason; // header timeout: retryable
      } else if ((e as Error).name === 'AbortError' || (e as Error).name === 'TimeoutError') {
        lastErr = new ProviderError(provider, 'request timed out or aborted');
        if (callerSignal?.aborted) throw lastErr;
      } else {
        lastErr = e as Error;
      }
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 750 * 2 ** attempt));
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr ?? new ProviderError(provider, 'request failed');
}

/** Parse a text/event-stream body, invoking onEvent for each `data:` payload. */
export async function consumeSse(
  res: Response,
  onEvent: (data: string) => void,
): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          if (data && data !== '[DONE]') onEvent(data);
        }
      }
    }
    const rest = buf.trim();
    if (rest.startsWith('data:')) {
      const data = rest.slice(5).trim();
      if (data && data !== '[DONE]') onEvent(data);
    }
  } catch (e) {
    // release the connection when onEvent throws (e.g. in-band stream errors)
    await reader.cancel().catch(() => {});
    throw e;
  }
}
