import type { JsonObject, JsonSchema } from '../domain/types.ts';

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

export type LLMMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: LLMToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; name: string };

export interface LLMRequest {
  model: string;
  messages: LLMMessage[];
  tools?: LLMToolDef[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  /** minimal | low | medium | high */
  reasoningEffort?: string;
  /** Structured output. */
  jsonSchema?: { name: string; schema: JsonSchema };
  /** Streaming text callback (providers may ignore, e.g. when tools force non-streaming). */
  onDelta?: (delta: string) => void;
  abortSignal?: AbortSignal;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMResponse {
  text: string;
  toolCalls: LLMToolCall[];
  usage: LLMUsage;
  finishReason?: string;
}

export interface LLMProvider {
  id: 'gemini' | 'openai' | 'anthropic' | 'mock';
  chat(req: LLMRequest, apiKey: string): Promise<LLMResponse>;
  listModels(apiKey: string): Promise<Array<{ id: string; displayName: string; description?: string }>>;
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

/** Route a model id to its provider. */
export function providerForModel(model: string): 'gemini' | 'openai' | 'anthropic' | 'mock' {
  const m = model.toLowerCase().replace(/^models\//, '');
  if (m.startsWith('mock/') || m === 'mock') return 'mock';
  if (m.startsWith('gemini') || m.startsWith('imagen') || m.startsWith('veo') || m.startsWith('learnlm')) return 'gemini';
  if (
    m.startsWith('gpt') ||
    m.startsWith('o1') ||
    m.startsWith('o3') ||
    m.startsWith('o4') ||
    m.startsWith('chatgpt') ||
    m.startsWith('text-embedding')
  ) return 'openai';
  if (m.startsWith('claude')) return 'anthropic';
  // default to gemini (the app's primary provider)
  return 'gemini';
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
      const res = await fetch(url, { ...init, signal: ctrl.signal });
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
