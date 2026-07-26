import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { grokProvider } from '../src/providers/grok.ts';
import { providerForModel } from '../src/providers/types.ts';

describe('xAI Grok provider', () => {
  it('maps tools and JSON schema, then parses tool calls and usage', async () => {
    const originalFetch = globalThis.fetch;
    let url = '';
    let body: any;
    globalThis.fetch = async (input, init) => {
      url = String(input);
      body = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({
        model: 'grok-4',
        choices: [{ finish_reason: 'tool_calls', message: { content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"query":"Willow"}' } }] } }],
        usage: { prompt_tokens: 12, completion_tokens: 4 },
      }), { status: 200 });
    };
    try {
      const response = await grokProvider.chat({
        model: 'grok-4',
        messages: [{ role: 'user', content: 'Find Willow' }],
        tools: [{ name: 'lookup', description: 'Search', parameters: { type: 'object', properties: { query: { type: 'string' } } } }],
        toolChoice: { name: 'lookup' },
        parallelToolCalls: false,
        jsonSchema: { name: 'result', schema: { type: 'object', properties: {} } },
      }, 'key');
      assert.equal(url, 'https://api.x.ai/v1/chat/completions');
      assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'lookup' } });
      assert.equal(body.parallel_tool_calls, false);
      assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: { name: 'result', schema: { type: 'object', properties: {} }, strict: true } });
      assert.deepEqual(response.toolCalls, [{ id: 'call_1', name: 'lookup', arguments: { query: 'Willow' } }]);
      assert.deepEqual(response.usage, { inputTokens: 12, outputTokens: 4, tokenStatus: 'reported', model: 'grok-4', provider: 'grok' });
    } finally { globalThis.fetch = originalFetch; }
  });

  it('discovers models and routes grok model ids', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ id: 'grok-4' }] }), { status: 200 });
    try {
      assert.equal(providerForModel('grok-4'), 'grok');
      assert.deepEqual(await grokProvider.listModels('key'), [{ id: 'grok-4', displayName: 'grok-4', description: 'xAI Grok model', inputModalities: ['text'], limitsSource: 'unknown' }]);
    } finally { globalThis.fetch = originalFetch; }
  });
});
