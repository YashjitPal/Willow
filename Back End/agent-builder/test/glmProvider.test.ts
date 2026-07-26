import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { glmProvider } from '../src/providers/glm.ts';

describe('Zhipu GLM provider', () => {
  it('maps OpenAI-compatible tools, JSON mode, tool calls, and usage', async () => {
    const originalFetch = globalThis.fetch;
    let url = '';
    let body: any;
    globalThis.fetch = async (input, init) => {
      url = String(input);
      body = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({
        model: 'glm-4.5',
        choices: [{ finish_reason: 'tool_calls', message: { content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"query":"Willow"}' } }] } }],
        usage: { prompt_tokens: 12, completion_tokens: 4 },
      }), { status: 200 });
    };
    try {
      const response = await glmProvider.chat({
        model: 'glm-4.5',
        messages: [{ role: 'user', content: 'Find Willow' }],
        tools: [{ name: 'lookup', description: 'Search', parameters: { type: 'object', properties: { query: { type: 'string' } } } }],
        toolChoice: { name: 'lookup' },
        parallelToolCalls: false,
        jsonSchema: { name: 'result', schema: { type: 'object', properties: {} } },
      }, 'key');
      assert.equal(url, 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
      assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'lookup' } });
      assert.equal(body.parallel_tool_calls, false);
      assert.deepEqual(body.response_format, { type: 'json_object' });
      assert.deepEqual(response.toolCalls, [{ id: 'call_1', name: 'lookup', arguments: { query: 'Willow' } }]);
      assert.deepEqual(response.usage, { inputTokens: 12, outputTokens: 4, tokenStatus: 'reported', model: 'glm-4.5', provider: 'glm' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('discovers models from the GLM catalog endpoint', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ id: 'glm-4.5' }] }), { status: 200 });
    try {
      const models = await glmProvider.listModels('key');
      assert.deepEqual(models, [{ id: 'glm-4.5', displayName: 'glm-4.5', description: 'Zhipu GLM model', inputModalities: ['text'], limitsSource: 'unknown' }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
