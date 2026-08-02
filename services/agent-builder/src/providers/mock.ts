/**
 * Mock provider — deterministic, key-free models for tests and demos.
 *
 * Models:
 *  - mock/echo        -> replies with the last user message text
 *  - mock/upper       -> replies with the last user message uppercased
 *  - mock/json        -> replies with JSON satisfying req.jsonSchema (or {"echo": ...})
 *  - mock/tool:NAME   -> first turn: calls tool NAME with {} (or parsed JSON body
 *                        of the last user message); after a tool result: replies
 *                        "TOOL_RESULT: <result text>"
 *  - mock/script      -> reads a JSON script from the system prompt between
 *                        <<MOCK ... MOCK>> markers: an array of turns, each
 *                        {"text": "..."} or {"tool": "name", "args": {...}}.
 *                        Turn index = number of prior assistant messages.
 *  - mock/fail        -> always throws (error-path testing)
 *  - mock/delay:MS    -> waits for MS milliseconds, respecting cancellation
 */

import type { JsonObject, JsonValue } from '../domain/types.ts';
import { pinnedModelTokenLimits } from '../domain/modelCapabilities.ts';
import {
  ProviderError,
  type LLMMessage,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
} from './types.ts';

function lastUserText(messages: LLMMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') return m.content;
  }
  return '';
}

function fillSchema(schema: JsonObject, seed: string): JsonValue {
  const type = schema.type;
  if (type === 'object' || (type === undefined && schema.properties)) {
    const out: JsonObject = {};
    const props = (schema.properties ?? {}) as Record<string, JsonObject>;
    for (const [k, sub] of Object.entries(props)) {
      out[k] = fillSchema(sub ?? {}, seed) as JsonObject[string];
    }
    return out;
  }
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0] as JsonValue;
  switch (type) {
    case 'string': return seed || 'mock';
    case 'number':
    case 'integer': return 42;
    case 'boolean': return true;
    case 'array': return [];
    case 'null': return null;
    default: return seed || 'mock';
  }
}

export const mockProvider: LLMProvider = {
  id: 'mock',
  prepareRequestBody(req) {
    return { model: req.model, messages: req.messages as unknown as JsonObject[string], tools: (req.tools ?? []) as unknown as JsonObject[string], toolChoice: (req.toolChoice ?? 'auto') as unknown as JsonObject[string], ...(req.jsonSchema ? { jsonSchema: req.jsonSchema as unknown as JsonObject[string] } : {}) };
  },

  async chat(req: LLMRequest): Promise<LLMResponse> {
    const model = req.model.toLowerCase();
    const input = lastUserText(req.messages);
    const usage = { inputTokens: input.length, outputTokens: 16, model: req.model };

    if (model === 'mock/fail') {
      throw new ProviderError('mock', 'mock/fail always fails');
    }

    if (model.startsWith('mock/delay:')) {
      const delayMs = Math.max(0, Number(model.slice('mock/delay:'.length)) || 0);
      await new Promise<void>((resolve, reject) => {
        const finish = () => {
          req.abortSignal?.removeEventListener('abort', onAbort);
          resolve();
        };
        const timer = setTimeout(finish, delayMs);
        const onAbort = () => {
          clearTimeout(timer);
          req.abortSignal?.removeEventListener('abort', onAbort);
          reject(req.abortSignal?.reason instanceof Error ? req.abortSignal.reason : new Error('aborted'));
        };
        if (req.abortSignal?.aborted) onAbort();
        else req.abortSignal?.addEventListener('abort', onAbort, { once: true });
      });
      const text = input;
      req.onDelta?.(text);
      return { text, toolCalls: [], usage, finishReason: 'stop' };
    }

    if (model.startsWith('mock/tool:')) {
      const toolName = req.model.slice('mock/tool:'.length);
      const hadToolResult = req.messages.some((m) => m.role === 'tool');
      if (!hadToolResult) {
        let args: JsonObject = {};
        try {
          const parsed = JSON.parse(input);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            args = parsed as JsonObject;
          }
        } catch { /* default empty args */ }
        return {
          text: '',
          toolCalls: [{ id: 'call_1', name: toolName, arguments: args }],
          usage,
          finishReason: 'tool_calls',
        };
      }
      const lastTool = [...req.messages].reverse().find((m) => m.role === 'tool');
      const text = `TOOL_RESULT: ${lastTool && lastTool.role === 'tool' ? lastTool.content : ''}`;
      req.onDelta?.(text);
      return { text, toolCalls: [], usage, finishReason: 'stop' };
    }

    if (model === 'mock/script') {
      const system = req.messages.find((m) => m.role === 'system');
      const match = system ? /<<MOCK([^]*?)MOCK>>/.exec(system.content) : null;
      if (!match) {
        throw new ProviderError('mock', 'mock/script requires <<MOCK ... MOCK>> in instructions');
      }
      let turns: Array<JsonObject>;
      try {
        turns = JSON.parse(match[1]) as Array<JsonObject>;
      } catch (e) {
        throw new ProviderError('mock', `invalid mock script JSON: ${(e as Error).message}`);
      }
      const turnIndex = req.messages.filter((m) => m.role === 'assistant').length;
      const turn = turns[Math.min(turnIndex, turns.length - 1)] ?? { text: '' };
      if (Array.isArray(turn.tools)) {
        return {
          text: '',
          toolCalls: (turn.tools as JsonObject[]).map((call, index) => ({
            id: `call_${turnIndex + 1}_${index + 1}`,
            name: String(call.name ?? call.tool ?? ''),
            arguments: (call.args ?? {}) as JsonObject,
          })).filter((call) => call.name),
          usage,
          finishReason: 'tool_calls',
        };
      }
      if (typeof turn.tool === 'string') {
        return {
          text: '',
          toolCalls: [
            {
              id: `call_${turnIndex + 1}`,
              name: turn.tool,
              arguments: (turn.args ?? {}) as JsonObject,
            },
          ],
          usage,
          finishReason: 'tool_calls',
        };
      }
      const text = typeof turn.text === 'string' ? turn.text : JSON.stringify(turn);
      req.onDelta?.(text);
      return { text, toolCalls: [], usage, finishReason: 'stop' };
    }

    if (model === 'mock/json') {
      let value: JsonValue;
      if (req.jsonSchema) {
        value = fillSchema(req.jsonSchema.schema, input);
      } else {
        try {
          value = JSON.parse(input) as JsonValue;
        } catch {
          value = { echo: input };
        }
      }
      const text = JSON.stringify(value);
      req.onDelta?.(text);
      return { text, toolCalls: [], usage, finishReason: 'stop' };
    }

    if (model === 'mock/upper') {
      const text = input.toUpperCase();
      req.onDelta?.(text);
      return { text, toolCalls: [], usage, finishReason: 'stop' };
    }

    // mock/echo and anything else
    const text = input;
    req.onDelta?.(text);
    return { text, toolCalls: [], usage, finishReason: 'stop' };
  },

  async listModels() {
    return [
      { id: 'mock/echo', displayName: 'Mock Echo', inputModalities: ['text' as const], ...pinnedModelTokenLimits('mock/echo') },
      { id: 'mock/upper', displayName: 'Mock Upper', inputModalities: ['text' as const], ...pinnedModelTokenLimits('mock/upper') },
      { id: 'mock/json', displayName: 'Mock JSON', inputModalities: ['text' as const], ...pinnedModelTokenLimits('mock/json') },
      { id: 'mock/script', displayName: 'Mock Script', inputModalities: ['text' as const], ...pinnedModelTokenLimits('mock/script') },
    ];
  },
};
