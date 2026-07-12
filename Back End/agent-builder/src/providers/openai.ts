/**
 * OpenAI provider — REST calls to api.openai.com/v1/chat/completions.
 * Streams when possible; assembles streamed tool-call deltas by index.
 */

import type { JsonObject } from '../domain/types.ts';
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

const BASE = 'https://api.openai.com/v1';

function isReasoningModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4') || m.startsWith('gpt-5');
}

function toOpenAiMessages(messages: LLMMessage[]): JsonObject[] {
  const out: JsonObject[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      out.push({ role: 'system', content: m.content });
    } else if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const msg: JsonObject = { role: 'assistant', content: m.content || null };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }));
      }
      out.push(msg);
    } else {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    }
  }
  return out;
}

function parseArgs(raw: string | undefined): JsonObject {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : { value: parsed };
  } catch {
    return { _raw: raw };
  }
}

export const openaiProvider: LLMProvider = {
  id: 'openai',

  async chat(req: LLMRequest, apiKey: string): Promise<LLMResponse> {
    const body: JsonObject = {
      model: req.model,
      messages: toOpenAiMessages(req.messages) as unknown as JsonObject[string],
    };

    const reasoning = isReasoningModel(req.model);
    if (req.temperature !== undefined && !reasoning) body.temperature = req.temperature;
    if (req.topP !== undefined && !reasoning) body.top_p = req.topP;
    if (req.maxTokens !== undefined) {
      if (reasoning) body.max_completion_tokens = req.maxTokens;
      else body.max_tokens = req.maxTokens;
    }
    if (req.reasoningEffort && reasoning) {
      // 'minimal' is only valid on the gpt-5 family; o-series accepts low|medium|high.
      const isO = /^o[134]/.test(req.model.toLowerCase());
      body.reasoning_effort =
        isO && req.reasoningEffort === 'minimal' ? 'low' : req.reasoningEffort;
    }
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description ?? '',
          parameters: t.parameters ?? { type: 'object', properties: {} },
        },
      })) as unknown as JsonObject[string];
    }
    if (req.jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: req.jsonSchema.name || 'response_schema',
          schema: req.jsonSchema.schema,
          strict: false,
        },
      } as unknown as JsonObject[string];
    }

    const streaming = !!req.onDelta;
    if (streaming) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }

    const res = await fetchWithRetry(
      `${BASE}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: req.abortSignal,
      },
      'openai',
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new ProviderError('openai', `HTTP ${res.status}: ${errBody.slice(0, 800)}`, res.status);
    }

    let text = '';
    let usage = { inputTokens: 0, outputTokens: 0 };
    let finishReason: string | undefined;

    if (streaming) {
      // accumulate tool calls by index
      const pending = new Map<number, { id: string; name: string; args: string }>();
      await consumeSse(res, (data) => {
        let chunk: JsonObject;
        try {
          chunk = JSON.parse(data) as JsonObject;
        } catch {
          return;
        }
        if (chunk.error) {
          const err = chunk.error as JsonObject;
          throw new ProviderError(
            'openai',
            `stream error: ${String(err.message ?? JSON.stringify(err)).slice(0, 500)}`,
          );
        }
        const choices = chunk.choices as JsonObject[] | undefined;
        const choice = choices?.[0];
        if (choice) {
          if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason;
          const delta = choice.delta as JsonObject | undefined;
          if (delta) {
            if (typeof delta.content === 'string' && delta.content) {
              text += delta.content;
              req.onDelta?.(delta.content);
            }
            const tcs = delta.tool_calls as JsonObject[] | undefined;
            for (const tc of tcs ?? []) {
              const idx = Number(tc.index ?? 0);
              const fn = tc.function as JsonObject | undefined;
              const cur = pending.get(idx) ?? { id: '', name: '', args: '' };
              if (typeof tc.id === 'string' && tc.id) cur.id = tc.id;
              if (typeof fn?.name === 'string' && fn.name) cur.name += fn.name;
              if (typeof fn?.arguments === 'string') cur.args += fn.arguments;
              pending.set(idx, cur);
            }
          }
        }
        const u = chunk.usage as JsonObject | undefined;
        if (u) {
          usage = {
            inputTokens: Number(u.prompt_tokens ?? 0),
            outputTokens: Number(u.completion_tokens ?? 0),
          };
        }
      });
      const toolCalls: LLMToolCall[] = [...pending.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([i, c]) => ({
          id: c.id || `call_${i + 1}`,
          name: c.name,
          arguments: parseArgs(c.args),
        }))
        .filter((c) => c.name);
      return { text, toolCalls, usage, finishReason };
    }

    const payload = (await res.json()) as JsonObject;
    const choices = payload.choices as JsonObject[] | undefined;
    const msg = choices?.[0]?.message as JsonObject | undefined;
    if (typeof choices?.[0]?.finish_reason === 'string') {
      finishReason = choices[0].finish_reason as string;
    }
    if (typeof msg?.content === 'string') text = msg.content;
    const toolCalls: LLMToolCall[] = [];
    const tcs = msg?.tool_calls as JsonObject[] | undefined;
    for (const [i, tc] of (tcs ?? []).entries()) {
      const fn = tc.function as JsonObject | undefined;
      toolCalls.push({
        id: typeof tc.id === 'string' ? tc.id : `call_${i + 1}`,
        name: String(fn?.name ?? ''),
        arguments: parseArgs(typeof fn?.arguments === 'string' ? fn.arguments : undefined),
      });
    }
    const u = payload.usage as JsonObject | undefined;
    if (u) {
      usage = {
        inputTokens: Number(u.prompt_tokens ?? 0),
        outputTokens: Number(u.completion_tokens ?? 0),
      };
    }
    return { text, toolCalls: toolCalls.filter((c) => c.name), usage, finishReason };
  },

  async listModels(apiKey: string) {
    const res = await fetchWithRetry(
      `${BASE}/models`,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${apiKey}` },
        timeoutMs: 20_000,
      },
      'openai',
    );
    if (!res.ok) throw new ProviderError('openai', `HTTP ${res.status}`, res.status);
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    return (data.data ?? [])
      .filter((m) => /^(gpt|o[134]|chatgpt)/.test(m.id))
      .map((m) => ({ id: m.id, displayName: m.id }));
  },
};
