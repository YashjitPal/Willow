/** OpenAI provider backed by the Responses API. */

import type { JsonObject, JsonValue } from '../domain/types.ts';
import {
  assertInputAttachmentSupport,
  consumeSse,
  fetchWithRetry,
  ProviderError,
  type LLMMessage,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  type LLMToolCall,
  inputModalitiesForModel,
} from './types.ts';
import { pinnedModelTokenLimits } from '../domain/modelCapabilities.ts';

const BASE = 'https://api.openai.com/v1';

/** Convert an OpenAI HTTP error envelope into a concise, actionable error.
 * The API returns `{error:{message,type,code,param}}`; exposing the typed code
 * matters to callers (for example invalid prompts versus rate limits) while
 * keeping arbitrary HTML/proxy bodies bounded.
 */
function providerHttpError(status: number, raw: string): ProviderError {
  try {
    const payload = JSON.parse(raw) as JsonObject;
    const error = payload.error as JsonObject | undefined;
    if (error && typeof error === 'object') {
      const message = String(error.message ?? 'OpenAI API error').slice(0, 600);
      const code = typeof error.code === 'string' ? ` (${error.code})` : '';
      const type = typeof error.type === 'string' && error.type !== error.code ? ` [${error.type}]` : '';
      const param = typeof error.param === 'string' ? ` param=${error.param}` : '';
      return new ProviderError('openai', `HTTP ${status}: ${message}${code}${type}${param}`, status);
    }
  } catch { /* proxies sometimes return plain text or HTML */ }
  return new ProviderError('openai', `HTTP ${status}: ${raw.slice(0, 800)}`, status);
}

function isReasoningModel(model: string): boolean {
  const value = model.toLowerCase();
  return value.startsWith('o1') || value.startsWith('o3') || value.startsWith('o4') || value.startsWith('gpt-5');
}

function parseArgs(raw: string | undefined): JsonObject {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as JsonValue;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonObject : { value: parsed };
  } catch {
    return { _raw: raw };
  }
}

function toResponseInput(messages: LLMMessage[]): { instructions?: string; input: JsonObject[] } {
  const instructions: string[] = [];
  const input: JsonObject[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      instructions.push(message.content);
    } else if (message.role === 'user') {
      const content: JsonObject[] = [{ type: 'input_text', text: message.content }];
      for (const attachment of message.attachments ?? []) {
        content.push({ type: 'input_image', image_url: `data:${attachment.mimeType};base64,${attachment.dataBase64}` });
      }
      input.push({ role: 'user', content: content as unknown as JsonObject[string] });
    } else if (message.role === 'assistant') {
      if (message.content) input.push({ role: 'assistant', content: message.content });
      for (const call of message.toolCalls ?? []) {
        input.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        });
      }
    } else {
      input.push({ type: 'function_call_output', call_id: message.toolCallId, output: message.content });
    }
  }
  return { ...(instructions.length ? { instructions: instructions.join('\n\n') } : {}), input };
}

function parseOutput(response: JsonObject): { text: string; toolCalls: LLMToolCall[] } {
  let text = '';
  const toolCalls: LLMToolCall[] = [];
  const output = Array.isArray(response.output) ? response.output as JsonObject[] : [];
  for (const item of output) {
    if (item.type === 'message') {
      const content = Array.isArray(item.content) ? item.content as JsonObject[] : [];
      for (const part of content) {
        if (part.type === 'output_text' && typeof part.text === 'string') text += part.text;
        if (part.type === 'refusal' && typeof part.refusal === 'string') text += part.refusal;
      }
    } else if (item.type === 'function_call') {
      toolCalls.push({
        id: String(item.call_id ?? item.id ?? `call_${toolCalls.length + 1}`),
        name: String(item.name ?? ''),
        arguments: parseArgs(typeof item.arguments === 'string' ? item.arguments : undefined),
      });
    }
  }
  return { text, toolCalls: toolCalls.filter((call) => call.name) };
}

function parseUsage(response: JsonObject) {
  const usage = response.usage as JsonObject | undefined;
  const inputDetails = usage?.input_tokens_details as JsonObject | undefined;
  const outputDetails = usage?.output_tokens_details as JsonObject | undefined;
  return {
    inputTokens: Number(usage?.input_tokens ?? 0),
    outputTokens: Number(usage?.output_tokens ?? 0),
    ...(!usage ? { tokenStatus: 'not_reported' as const } : {}),
    cachedInputTokens: Number(inputDetails?.cached_tokens ?? 0),
    reasoningTokens: Number(outputDetails?.reasoning_tokens ?? 0),
    model: typeof response.model === 'string' ? response.model : undefined,
  };
}

function finishReason(response: JsonObject, hasToolCalls: boolean): string | undefined {
  if (hasToolCalls) return 'tool_calls';
  if (response.status === 'completed') return 'stop';
  const incomplete = response.incomplete_details as JsonObject | undefined;
  return typeof incomplete?.reason === 'string' ? incomplete.reason : typeof response.status === 'string' ? response.status : undefined;
}

function prepareOpenAiBody(req: LLMRequest): JsonObject {
  const mapped = toResponseInput(req.messages);
  const body: JsonObject = { model: req.model, input: mapped.input as unknown as JsonObject[string], ...(mapped.instructions ? { instructions: mapped.instructions } : {}) };
  const reasoning = isReasoningModel(req.model);
  if (req.temperature !== undefined && !reasoning) body.temperature = req.temperature;
  if (req.topP !== undefined && !reasoning) body.top_p = req.topP;
  if (req.maxTokens !== undefined) body.max_output_tokens = req.maxTokens;
  if (req.promptCache?.policy === 'enabled') {
    if (req.promptCache.key) body.prompt_cache_key = req.promptCache.key;
    if (req.promptCache.retention) body.prompt_cache_retention = req.promptCache.retention;
  }
  if (req.reasoningEffort && reasoning) {
    const isO = /^o[134]/.test(req.model.toLowerCase());
    body.reasoning = { effort: isO && req.reasoningEffort === 'minimal' ? 'low' : req.reasoningEffort };
  }
  if (req.tools?.length && req.toolChoice !== 'none') {
    body.tools = req.tools.map((tool) => ({ type: 'function', name: tool.name, description: tool.description ?? '', parameters: tool.parameters ?? { type: 'object', properties: {}, required: [], additionalProperties: false }, strict: false })) as unknown as JsonObject[string];
    body.tool_choice = typeof req.toolChoice === 'object' ? { type: 'function', name: req.toolChoice.name } : req.toolChoice ?? 'auto';
    body.parallel_tool_calls = req.parallelToolCalls !== false;
  }
  if (req.verbosity && req.model.toLowerCase().startsWith('gpt-5')) body.text = { verbosity: req.verbosity };
  if (req.jsonSchema) body.text = { ...((body.text as JsonObject | undefined) ?? {}), format: { type: 'json_schema', name: req.jsonSchema.name || 'response_schema', schema: req.jsonSchema.schema, strict: true } };
  if (req.onDelta) body.stream = true;
  return body;
}

export const openaiProvider: LLMProvider = {
  id: 'openai',
  prepareRequestBody: prepareOpenAiBody,

  async chat(req: LLMRequest, apiKey: string): Promise<LLMResponse> {
    assertInputAttachmentSupport('openai', req.model, req.messages);
    const body = prepareOpenAiBody(req);
    const streaming = Boolean(req.onDelta);

    const response = await fetchWithRetry(`${BASE}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: req.abortSignal,
    }, 'openai');
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw providerHttpError(response.status, errorBody);
    }

    if (!streaming) {
      const payload = await response.json() as JsonObject;
      if (payload.error) {
        const error = payload.error as JsonObject;
        throw new ProviderError('openai', String(error.message ?? 'Responses API error'));
      }
      const parsed = parseOutput(payload);
      return {
        ...parsed,
        usage: parseUsage(payload),
        finishReason: finishReason(payload, parsed.toolCalls.length > 0),
      };
    }

    let text = '';
    let completed: JsonObject | undefined;
    const pending = new Map<string, { id: string; name: string; arguments: string }>();
    await consumeSse(response, (data) => {
      let event: JsonObject;
      try { event = JSON.parse(data) as JsonObject; }
      catch { return; }
      const type = String(event.type ?? '');
      if (type === 'error' || type === 'response.failed') {
        const error = (event.error ?? (event.response as JsonObject | undefined)?.error) as JsonObject | undefined;
        throw new ProviderError('openai', `stream error: ${String(error?.message ?? 'response failed').slice(0, 500)}`);
      }
      if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
        text += event.delta;
        req.onDelta?.(event.delta);
      } else if (type === 'response.output_item.added') {
        const item = event.item as JsonObject | undefined;
        if (item?.type === 'function_call') {
          const key = String(item.id ?? event.output_index ?? pending.size);
          pending.set(key, {
            id: String(item.call_id ?? item.id ?? `call_${pending.size + 1}`),
            name: String(item.name ?? ''),
            arguments: typeof item.arguments === 'string' ? item.arguments : '',
          });
        }
      } else if (type === 'response.function_call_arguments.delta') {
        const key = String(event.item_id ?? event.output_index ?? '');
        const current = pending.get(key) ?? { id: key || `call_${pending.size + 1}`, name: '', arguments: '' };
        if (typeof event.delta === 'string') current.arguments += event.delta;
        pending.set(key, current);
      } else if (type === 'response.function_call_arguments.done') {
        // The Responses stream emits a terminal arguments event separately
        // from output_item.done. Prefer its complete payload when present so
        // tool calls are still executable if the item event is omitted or
        // contains only metadata.
        const key = String(event.item_id ?? event.output_index ?? '');
        const current = pending.get(key) ?? { id: key || `call_${pending.size + 1}`, name: '', arguments: '' };
        if (typeof event.arguments === 'string') current.arguments = event.arguments;
        pending.set(key, current);
      } else if (type === 'response.output_item.done') {
        const item = event.item as JsonObject | undefined;
        if (item?.type === 'function_call') {
          const key = String(item.id ?? event.output_index ?? pending.size);
          pending.set(key, {
            id: String(item.call_id ?? item.id ?? `call_${pending.size + 1}`),
            name: String(item.name ?? pending.get(key)?.name ?? ''),
            arguments: typeof item.arguments === 'string' ? item.arguments : pending.get(key)?.arguments ?? '',
          });
        }
      } else if (type === 'response.completed' || type === 'response.incomplete') {
        completed = event.response as JsonObject | undefined;
      }
    });

    const parsedCompleted = completed ? parseOutput(completed) : { text: '', toolCalls: [] as LLMToolCall[] };
    const toolCalls = parsedCompleted.toolCalls.length ? parsedCompleted.toolCalls : [...pending.values()].map((call) => ({
      id: call.id,
      name: call.name,
      arguments: parseArgs(call.arguments),
    })).filter((call) => call.name);
    return {
      text: text || parsedCompleted.text,
      toolCalls,
      usage: completed ? parseUsage(completed) : { inputTokens: 0, outputTokens: 0, tokenStatus: 'not_reported' },
      finishReason: completed ? finishReason(completed, toolCalls.length > 0) : toolCalls.length ? 'tool_calls' : undefined,
    };
  },

  async listModels(apiKey: string) {
    const discovered: Array<{ id: string }> = [];
    const seenCursors = new Set<string>();
    let after: string | undefined;
    do {
      const query = new URLSearchParams();
      if (after) query.set('after', after);
      const response = await fetchWithRetry(`${BASE}/models${query.toString() ? `?${query}` : ''}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${apiKey}` },
        timeoutMs: 20_000,
      }, 'openai');
      if (!response.ok) throw new ProviderError('openai', `HTTP ${response.status}`, response.status);
      const data = await response.json() as { data?: Array<{ id: string }>; has_more?: boolean; last_id?: string };
      discovered.push(...(data.data ?? []));
      const next = data.has_more ? data.last_id?.trim() : undefined;
      if (next && seenCursors.has(next)) throw new ProviderError('openai', 'model discovery returned a repeated page cursor');
      if (next) seenCursors.add(next);
      after = next;
    } while (after);
    return discovered
      .filter((model) => /^(gpt|o[134]|chatgpt)/.test(model.id))
      .map((model) => ({ id: model.id, displayName: model.id, inputModalities: inputModalitiesForModel('openai', model.id), ...pinnedModelTokenLimits(model.id) }));
  },
};
