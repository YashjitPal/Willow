/**
 * Gemini provider — REST calls to generativelanguage.googleapis.com (v1beta).
 * Streams text via :streamGenerateContent?alt=sse when no JSON schema is set;
 * uses non-streaming :generateContent otherwise.
 */

import type { JsonObject, JsonSchema } from '../domain/types.ts';
import {
  consumeSse,
  fetchWithRetry,
  ProviderError,
  type LLMMessage,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  type LLMToolCall,
} from './types.ts';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: JsonObject };
  functionResponse?: { name: string; response: JsonObject };
  thought?: boolean;
  thoughtSignature?: string;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/** Strip unsupported JSON-schema keys for Gemini's responseSchema/parameters. */
function sanitizeSchema(schema: JsonSchema | undefined): JsonSchema | undefined {
  if (!schema) return undefined;
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (node && typeof node === 'object') {
      const out: JsonObject = {};
      for (const [k, v] of Object.entries(node as JsonObject)) {
        if (k === 'additionalProperties' || k === '$schema' || k === 'default') continue;
        out[k] = clean(v) as JsonObject[string];
      }
      return out;
    }
    return node;
  };
  return clean(schema) as JsonSchema;
}

function toContents(messages: LLMMessage[]): { system?: string; contents: GeminiContent[] } {
  let system: string | undefined;
  const contents: GeminiContent[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      system = system ? `${system}\n\n${m.content}` : m.content;
      continue;
    }
    if (m.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: m.content }] });
      continue;
    }
    if (m.role === 'assistant') {
      const parts: GeminiPart[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls ?? []) {
        parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
      }
      if (parts.length) contents.push({ role: 'model', parts });
      continue;
    }
    // tool result
    let response: JsonObject;
    try {
      const parsed = JSON.parse(m.content);
      response = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as JsonObject)
        : { result: parsed };
    } catch {
      response = { result: m.content };
    }
    contents.push({
      role: 'user',
      parts: [{ functionResponse: { name: m.name, response } }],
    });
  }
  return { system, contents };
}

function effortToThinking(model: string, effort?: string): JsonObject | undefined {
  if (!effort) return undefined;
  // thinkingConfig is only accepted by Gemini 2.5+ / 3.x models.
  if (!/gemini-(2\.5|[3-9])/i.test(model)) return undefined;
  // thinkingBudget: -1 dynamic; 0 disables (flash only). Map effort to budgets.
  const budgets: Record<string, number> = { minimal: 0, low: 1024, medium: 8192, high: 24576 };
  const budget = budgets[effort];
  if (budget === undefined) return undefined;
  if (budget === 0 && /pro/i.test(model)) return { thinkingBudget: 128 }; // pro can't disable
  return { thinkingBudget: budget };
}

export const geminiProvider: LLMProvider = {
  id: 'gemini',

  async chat(req: LLMRequest, apiKey: string): Promise<LLMResponse> {
    const model = req.model.replace(/^models\//, '');
    const { system, contents } = toContents(req.messages);

    const generationConfig: JsonObject = {};
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
    if (req.maxTokens !== undefined) generationConfig.maxOutputTokens = req.maxTokens;
    if (req.topP !== undefined) generationConfig.topP = req.topP;
    if (req.jsonSchema) {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseSchema = sanitizeSchema(req.jsonSchema.schema) ?? {};
    }
    const thinking = effortToThinking(model, req.reasoningEffort);
    if (thinking) generationConfig.thinkingConfig = thinking;

    const body: JsonObject = { contents: contents as unknown as JsonObject[string] };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
    if (req.tools?.length) {
      body.tools = [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description ?? '',
            parameters: sanitizeSchema(t.parameters) ?? { type: 'object', properties: {} },
          })),
        },
      ] as unknown as JsonObject[string];
    }

    const streaming = !!req.onDelta && !req.jsonSchema;
    const url = streaming
      ? `${BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`
      : `${BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const res = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: req.abortSignal,
      },
      'gemini',
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new ProviderError('gemini', `HTTP ${res.status}: ${errBody.slice(0, 800)}`, res.status);
    }

    let text = '';
    const toolCalls: LLMToolCall[] = [];
    let usage = { inputTokens: 0, outputTokens: 0 };
    let finishReason: string | undefined;
    let callSeq = 0;

    const absorb = (payload: JsonObject) => {
      if (payload.error) {
        const err = payload.error as JsonObject;
        throw new ProviderError(
          'gemini',
          `stream error: ${String(err.message ?? JSON.stringify(err)).slice(0, 500)}`,
          typeof err.code === 'number' ? err.code : undefined,
        );
      }
      const candidates = payload.candidates as JsonObject[] | undefined;
      const cand = candidates?.[0];
      if (cand) {
        if (typeof cand.finishReason === 'string') finishReason = cand.finishReason;
        const content = cand.content as JsonObject | undefined;
        const parts = (content?.parts ?? []) as GeminiPart[];
        for (const part of parts) {
          if (part.thought) continue;
          if (typeof part.text === 'string') {
            text += part.text;
            req.onDelta?.(part.text);
          }
          if (part.functionCall) {
            callSeq += 1;
            toolCalls.push({
              id: `call_${callSeq}`,
              name: part.functionCall.name,
              arguments: (part.functionCall.args ?? {}) as JsonObject,
            });
          }
        }
      }
      const meta = payload.usageMetadata as JsonObject | undefined;
      if (meta) {
        usage = {
          inputTokens: Number(meta.promptTokenCount ?? 0),
          outputTokens:
            Number(meta.candidatesTokenCount ?? 0) + Number(meta.thoughtsTokenCount ?? 0),
        };
      }
    };

    if (streaming) {
      await consumeSse(res, (data) => {
        let payload: JsonObject | undefined;
        try {
          payload = JSON.parse(data) as JsonObject;
        } catch { /* skip malformed chunk */ }
        if (payload) absorb(payload); // ProviderError from error chunks propagates
      });
    } else {
      const payload = (await res.json()) as JsonObject;
      if (payload.error) {
        const err = payload.error as JsonObject;
        throw new ProviderError('gemini', String(err.message ?? 'unknown error'));
      }
      absorb(payload);
      if (text && req.onDelta) req.onDelta(text);
    }

    return { text, toolCalls, usage, finishReason };
  },

  async listModels(apiKey: string) {
    const res = await fetchWithRetry(
      `${BASE}/models?pageSize=100&key=${encodeURIComponent(apiKey)}`,
      { method: 'GET', timeoutMs: 20_000 },
      'gemini',
    );
    if (!res.ok) {
      throw new ProviderError('gemini', `HTTP ${res.status}`, res.status);
    }
    const data = (await res.json()) as {
      models?: Array<{
        name: string;
        displayName?: string;
        description?: string;
        supportedGenerationMethods?: string[];
      }>;
    };
    return (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => ({
        id: m.name.replace(/^models\//, ''),
        displayName: m.displayName ?? m.name,
        description: m.description,
      }));
  },
};
