/** xAI Grok provider (OpenAI-compatible Chat Completions API). */
import type { JsonObject } from '../domain/types.ts';
import { fetchWithRetry, ProviderError, type LLMProvider, type LLMRequest, type LLMResponse, type LLMMessage, type LLMToolCall } from './types.ts';

const BASE = 'https://api.x.ai/v1';
function messages(req: LLMRequest): JsonObject[string][] {
  return req.messages.map((m) => ({ role: m.role, content: m.content, ...(m.role === 'assistant' && m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) } : {}), ...(m.role === 'tool' ? { tool_call_id: m.toolCallId, name: m.name } : {}) })) as unknown as JsonObject[string][];
}
function parseArgs(value: unknown): JsonObject {
  if (typeof value !== 'string') return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonObject : {}; } catch { return {}; }
}
export const grokProvider: LLMProvider = {
  id: 'grok',
  prepareRequestBody(req) { return { model: req.model, messages: messages(req), ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}), ...(req.toolChoice ? { tool_choice: typeof req.toolChoice === 'object' ? { type: 'function', function: { name: req.toolChoice.name } } : req.toolChoice } : {}), ...(req.parallelToolCalls !== undefined ? { parallel_tool_calls: req.parallelToolCalls } : {}), ...(req.temperature !== undefined ? { temperature: req.temperature } : {}), ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}), ...(req.topP !== undefined ? { top_p: req.topP } : {}), ...(req.jsonSchema ? { response_format: { type: 'json_schema', json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: true } } } : {}) } as JsonObject; },
  async chat(req, apiKey): Promise<LLMResponse> {
    const body = this.prepareRequestBody(req);
    const res = await fetchWithRetry(`${BASE}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: req.abortSignal, timeoutMs: 120_000 }, 'grok');
    if (!res.ok) throw new ProviderError('grok', `HTTP ${res.status}: ${(await res.text()).slice(0, 600)}`, res.status);
    const payload = await res.json() as JsonObject;
    const choice = Array.isArray(payload.choices) ? payload.choices[0] as JsonObject : {};
    const message = choice.message as JsonObject | undefined;
    const calls: LLMToolCall[] = Array.isArray(message?.tool_calls) ? (message.tool_calls as JsonObject[]).map((c, i) => { const fn = c.function as JsonObject ?? {}; return { id: String(c.id ?? `call_${i + 1}`), name: String(fn.name ?? ''), arguments: parseArgs(fn.arguments) }; }) : [];
    const text = typeof message?.content === 'string' ? message.content : '';
    if (text) req.onDelta?.(text);
    const usage = (payload.usage as JsonObject | undefined) ?? {};
    return { text, toolCalls: calls, usage: { inputTokens: Number(usage.prompt_tokens ?? 0), outputTokens: Number(usage.completion_tokens ?? 0), tokenStatus: payload.usage ? 'reported' : 'not_reported', model: String(payload.model ?? req.model), provider: 'grok' }, finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined };
  },
  async listModels(apiKey) {
    const res = await fetchWithRetry(`${BASE}/models`, { method: 'GET', headers: { authorization: `Bearer ${apiKey}` }, timeoutMs: 30_000 }, 'grok');
    if (!res.ok) throw new ProviderError('grok', `HTTP ${res.status}: ${(await res.text()).slice(0, 600)}`, res.status);
    const payload = await res.json() as JsonObject;
    return (Array.isArray(payload.data) ? payload.data : []).map((m) => { const x = m as JsonObject; return { id: String(x.id), displayName: String(x.id), description: 'xAI Grok model', inputModalities: ['text'] as const, limitsSource: 'unknown' as const }; });
  },
};
