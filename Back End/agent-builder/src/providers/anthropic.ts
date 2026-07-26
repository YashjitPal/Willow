/**
 * Anthropic provider — REST calls to api.anthropic.com/v1/messages.
 * Streams text + assembles tool_use input_json_delta blocks.
 */

import type { JsonObject } from '../domain/types.ts';
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

const BASE = 'https://api.anthropic.com/v1';
const VERSION = '2023-06-01';

function toAnthropicMessages(messages: LLMMessage[]): { system?: string; messages: JsonObject[] } {
  let system: string | undefined;
  const out: JsonObject[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      system = system ? `${system}\n\n${m.content}` : m.content;
      continue;
    }
    if (m.role === 'user') {
      const blocks: JsonObject[] = [{ type: 'text', text: m.content }];
      for (const attachment of m.attachments ?? []) {
        blocks.push({ type: 'image', source: { type: 'base64', media_type: attachment.mimeType, data: attachment.dataBase64 } });
      }
      out.push({ role: 'user', content: blocks as unknown as JsonObject[string] });
      continue;
    }
    if (m.role === 'assistant') {
      const blocks: JsonObject[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
      }
      if (blocks.length) out.push({ role: 'assistant', content: blocks as unknown as JsonObject[string] });
      continue;
    }
    // tool result -> user message with tool_result block
    out.push({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content },
      ] as unknown as JsonObject[string],
    });
  }
  // Anthropic requires alternating roles beginning with user; merge consecutive same-role
  const merged: JsonObject[] = [];
  for (const m of out) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) {
      const prevContent = Array.isArray(prev.content)
        ? (prev.content as JsonObject[])
        : [{ type: 'text', text: String(prev.content) }];
      const curContent = Array.isArray(m.content)
        ? (m.content as JsonObject[])
        : [{ type: 'text', text: String(m.content) }];
      prev.content = [...prevContent, ...curContent] as unknown as JsonObject[string];
    } else {
      merged.push(m);
    }
  }
  return { system, messages: merged };
}

export const anthropicProvider: LLMProvider = {
  id: 'anthropic',
  prepareRequestBody(req) {
    const { system, messages } = toAnthropicMessages(req.messages);
    let sys = system;
    if (req.jsonSchema) {
      const note = `You must respond with ONLY a single JSON value that validates against this JSON schema (no prose, no markdown fences):\n${JSON.stringify(req.jsonSchema.schema)}`;
      sys = sys ? `${sys}\n\n${note}` : note;
    }
    const body: JsonObject = { model: req.model, max_tokens: req.maxTokens ?? 4096, messages: messages as unknown as JsonObject[string] };
    if (sys) body.system = req.promptCache?.policy === 'enabled' ? [{ type: 'text', text: sys, cache_control: { type: 'ephemeral', ttl: req.promptCache.retention ?? '5m' } }] as unknown as JsonObject[string] : sys;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.topP !== undefined) body.top_p = req.topP;
    if (req.tools?.length && req.toolChoice !== 'none') {
      body.tools = req.tools.map((tool) => ({ name: tool.name, description: tool.description ?? '', input_schema: tool.parameters ?? { type: 'object', properties: {} } })) as unknown as JsonObject[string];
      body.tool_choice = typeof req.toolChoice === 'object' ? { type: 'tool', name: req.toolChoice.name } : { type: req.toolChoice === 'required' ? 'any' : 'auto' };
      (body.tool_choice as JsonObject).disable_parallel_tool_use = req.parallelToolCalls === false;
    }
    if (req.onDelta) body.stream = true;
    return body;
  },

  async chat(req: LLMRequest, apiKey: string): Promise<LLMResponse> {
    assertInputAttachmentSupport('anthropic', req.model, req.messages);
    const { system, messages } = toAnthropicMessages(req.messages);

    // Structured output: Anthropic has no response_format; instruct via system.
    let sys = system;
    if (req.jsonSchema) {
      const schemaNote =
        `You must respond with ONLY a single JSON value that validates against this JSON schema ` +
        `(no prose, no markdown fences):\n${JSON.stringify(req.jsonSchema.schema)}`;
      sys = sys ? `${sys}\n\n${schemaNote}` : schemaNote;
    }

    const body: JsonObject = {
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      messages: messages as unknown as JsonObject[string],
    };
    if (sys) {
      body.system = req.promptCache?.policy === 'enabled'
        ? [{ type: 'text', text: sys, cache_control: { type: 'ephemeral', ttl: req.promptCache.retention ?? '5m' } }] as unknown as JsonObject[string]
        : sys;
    }
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.topP !== undefined) body.top_p = req.topP;
    // NOTE: reasoningEffort is deliberately NOT mapped to the legacy
    // `thinking: {type:'enabled', budget_tokens}` param — current Claude
    // models reject it, and replaying thinking blocks through the tool loop
    // needs dedicated handling. Claude models reason adaptively by default.
    if (req.tools?.length && req.toolChoice !== 'none') {
      body.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        input_schema: t.parameters ?? { type: 'object', properties: {} },
      })) as unknown as JsonObject[string];
      body.tool_choice = typeof req.toolChoice === 'object'
        ? { type: 'tool', name: req.toolChoice.name }
        : { type: req.toolChoice === 'required' ? 'any' : 'auto' };
      (body.tool_choice as JsonObject).disable_parallel_tool_use = req.parallelToolCalls === false;
    }

    const streaming = !!req.onDelta;
    if (streaming) body.stream = true;
    const preparedBody = anthropicProvider.prepareRequestBody(req);

    const res = await fetchWithRetry(
      `${BASE}/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': VERSION,
        },
        body: JSON.stringify(preparedBody),
        signal: req.abortSignal,
      },
      'anthropic',
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new ProviderError('anthropic', `HTTP ${res.status}: ${errBody.slice(0, 800)}`, res.status);
    }

    let text = '';
    const toolCalls: LLMToolCall[] = [];
    let usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, model: req.model };
    let finishReason: string | undefined;

    if (streaming) {
      // index -> partial tool_use
      const pendingTools = new Map<number, { id: string; name: string; json: string }>();
      await consumeSse(res, (data) => {
        let ev: JsonObject;
        try {
          ev = JSON.parse(data) as JsonObject;
        } catch {
          return;
        }
        const type = ev.type as string;
        if (type === 'error') {
          const err = ev.error as JsonObject | undefined;
          throw new ProviderError(
            'anthropic',
            `stream error: ${String(err?.message ?? JSON.stringify(err ?? ev)).slice(0, 500)}`,
          );
        }
        if (type === 'message_start') {
          const msg = ev.message as JsonObject | undefined;
          const u = msg?.usage as JsonObject | undefined;
          if (u) {
            usage.cachedInputTokens = Number(u.cache_read_input_tokens ?? 0);
            usage.cacheWriteInputTokens = Number(u.cache_creation_input_tokens ?? 0);
            usage.inputTokens = Number(u.input_tokens ?? 0) + usage.cachedInputTokens + usage.cacheWriteInputTokens;
          }
          if (typeof msg?.model === 'string') usage.model = msg.model;
        } else if (type === 'content_block_start') {
          const block = ev.content_block as JsonObject | undefined;
          if (block?.type === 'tool_use') {
            pendingTools.set(Number(ev.index ?? 0), {
              id: String(block.id ?? ''),
              name: String(block.name ?? ''),
              json: '',
            });
          }
        } else if (type === 'content_block_delta') {
          const delta = ev.delta as JsonObject | undefined;
          if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
            text += delta.text;
            req.onDelta?.(delta.text);
          } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
            const cur = pendingTools.get(Number(ev.index ?? 0));
            if (cur) cur.json += delta.partial_json;
          }
        } else if (type === 'message_delta') {
          const delta = ev.delta as JsonObject | undefined;
          if (typeof delta?.stop_reason === 'string') finishReason = delta.stop_reason;
          const u = ev.usage as JsonObject | undefined;
          if (u) usage.outputTokens = Number(u.output_tokens ?? 0);
        }
      });
      for (const [i, t] of [...pendingTools.entries()].sort((a, b) => a[0] - b[0])) {
        let args: JsonObject = {};
        try {
          const parsed = JSON.parse(t.json || '{}');
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as JsonObject;
        } catch { /* leave empty */ }
        toolCalls.push({ id: t.id || `call_${i + 1}`, name: t.name, arguments: args });
      }
      return { text, toolCalls: toolCalls.filter((c) => c.name), usage, finishReason };
    }

    const payload = (await res.json()) as JsonObject;
    const content = payload.content as JsonObject[] | undefined;
    for (const block of content ?? []) {
      if (block.type === 'text' && typeof block.text === 'string') text += block.text;
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: String(block.id ?? `call_${toolCalls.length + 1}`),
          name: String(block.name ?? ''),
          arguments: (block.input ?? {}) as JsonObject,
        });
      }
    }
    if (typeof payload.stop_reason === 'string') finishReason = payload.stop_reason;
    const u = payload.usage as JsonObject | undefined;
    if (u) {
      usage = {
        inputTokens:
          Number(u.input_tokens ?? 0)
          + Number(u.cache_read_input_tokens ?? 0)
          + Number(u.cache_creation_input_tokens ?? 0),
        outputTokens: Number(u.output_tokens ?? 0),
        cachedInputTokens: Number(u.cache_read_input_tokens ?? 0),
        cacheWriteInputTokens: Number(u.cache_creation_input_tokens ?? 0),
        model: typeof payload.model === 'string' ? payload.model : req.model,
      };
    }
    return { text, toolCalls: toolCalls.filter((c) => c.name), usage, finishReason };
  },

  async listModels(apiKey: string) {
    const res = await fetchWithRetry(
      `${BASE}/models?limit=100`,
      {
        method: 'GET',
        headers: { 'x-api-key': apiKey, 'anthropic-version': VERSION },
        timeoutMs: 20_000,
      },
      'anthropic',
    );
    if (!res.ok) throw new ProviderError('anthropic', `HTTP ${res.status}`, res.status);
    const data = (await res.json()) as {
      data?: Array<{ id: string; display_name?: string }>;
    };
    return (data.data ?? []).map((m) => ({
      id: m.id,
      displayName: m.display_name ?? m.id,
      inputModalities: inputModalitiesForModel('anthropic', m.id),
      ...pinnedModelTokenLimits(m.id),
    }));
  },
};
