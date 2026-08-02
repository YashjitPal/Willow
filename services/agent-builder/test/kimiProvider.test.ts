import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { kimiProvider } from '../src/providers/kimi.ts';
import { providerForKnownModel, providerForModel } from '../src/providers/types.ts';

describe('Kimi provider', () => {
  it('prepares OpenAI-compatible tools and structured output', () => {
    const body = kimiProvider.prepareRequestBody({
      model: 'kimi-k2.5',
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'lookup', arguments: { q: 'x' } }] },
        { role: 'tool', toolCallId: 'call_1', name: 'lookup', content: '{"ok":true}' },
      ],
      tools: [{ name: 'lookup', description: 'Look up a value', parameters: { type: 'object', properties: { q: { type: 'string' } } } }],
      toolChoice: { name: 'lookup' },
      parallelToolCalls: false,
      jsonSchema: { name: 'answer', schema: { type: 'object', properties: { answer: { type: 'string' } } } },
      temperature: 0.2,
      maxTokens: 300,
    }) as any;
    assert.equal(body.model, 'kimi-k2.5');
    assert.equal(body.messages[1].tool_calls[0].function.arguments, '{"q":"x"}');
    assert.equal(body.messages[2].tool_call_id, 'call_1');
    assert.equal(body.tools[0].function.name, 'lookup');
    assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'lookup' } });
    assert.equal(body.parallel_tool_calls, false);
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.max_tokens, 300);
  });

  it('parses text, tool calls, usage, and forwards the authorization header', async () => {
    const originalFetch = globalThis.fetch;
    let requestUrl = '';
    let authorization = '';
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(input);
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      return new Response(JSON.stringify({
        model: 'kimi-k2.5-20260701',
        choices: [{ finish_reason: 'tool_calls', message: { content: 'Checking', tool_calls: [{ id: 'call_9', function: { name: 'lookup', arguments: '{"q":"willow"}' } }] } }],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      let delta = '';
      const response = await kimiProvider.chat({ model: 'kimi-k2.5', messages: [{ role: 'user', content: 'Find it' }], onDelta: (value) => { delta += value; } }, 'secret');
      assert.equal(requestUrl, 'https://api.moonshot.ai/v1/chat/completions');
      assert.equal(authorization, 'Bearer secret');
      assert.equal(response.text, 'Checking');
      assert.equal(delta, 'Checking');
      assert.deepEqual(response.toolCalls, [{ id: 'call_9', name: 'lookup', arguments: { q: 'willow' } }]);
      assert.deepEqual(response.usage, { inputTokens: 11, outputTokens: 7, tokenStatus: 'reported', model: 'kimi-k2.5-20260701', provider: 'kimi' });
      assert.equal(response.finishReason, 'tool_calls');
    } finally { globalThis.fetch = originalFetch; }
  });

  it('lists models and routes Kimi and Moonshot model ids', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [{ id: 'kimi-k2.5' }, { id: 'moonshot-v1-128k' }] }), { status: 200 })) as typeof fetch;
    try {
      assert.deepEqual(await kimiProvider.listModels('key'), [
        { id: 'kimi-k2.5', displayName: 'kimi-k2.5', description: 'Moonshot Kimi model', inputModalities: ['text'], limitsSource: 'unknown' },
        { id: 'moonshot-v1-128k', displayName: 'moonshot-v1-128k', description: 'Moonshot Kimi model', inputModalities: ['text'], limitsSource: 'unknown' },
      ]);
      assert.equal(providerForKnownModel('kimi-k2.5'), 'kimi');
      assert.equal(providerForModel('moonshot-v1-128k'), 'kimi');
    } finally { globalThis.fetch = originalFetch; }
  });
});
