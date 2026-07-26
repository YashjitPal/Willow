import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openaiProvider } from '../src/providers/openai.ts';

describe('OpenAI Responses provider', () => {
  it('does not treat a response with missing usage as a free reported call', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      model: 'gpt-5-mini',
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    try {
      const response = await openaiProvider.chat({ model: 'gpt-5-mini', messages: [{ role: 'user', content: 'hi' }] }, 'test-key');
      assert.deepEqual(response.usage, {
        inputTokens: 0,
        outputTokens: 0,
        tokenStatus: 'not_reported',
        cachedInputTokens: 0,
        reasoningTokens: 0,
        model: 'gpt-5-mini',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses Responses API items for tool history and strict structured output', async () => {
    const originalFetch = globalThis.fetch;
    let requestUrl = '';
    let requestBody: any;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: 'resp_1',
        status: 'completed',
        output: [{ type: 'function_call', id: 'fc_2', call_id: 'call_2', name: 'lookup', arguments: '{"query":"next"}' }],
        model: 'gpt-5-2026-06-01',
        usage: {
          input_tokens: 17,
          output_tokens: 5,
          input_tokens_details: { cached_tokens: 7 },
          output_tokens_details: { reasoning_tokens: 3 },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      const response = await openaiProvider.chat({
        model: 'gpt-5',
        messages: [
          { role: 'system', content: 'Be precise.' },
          { role: 'user', content: 'Find it.', attachments: [{ name: 'pixel.png', mimeType: 'image/png', dataBase64: 'aW1hZ2U=' }] },
          { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'lookup', arguments: { query: 'first' } }] },
          { role: 'tool', toolCallId: 'call_1', name: 'lookup', content: '{"found":true}' },
        ],
        tools: [{ name: 'lookup', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } }],
        toolChoice: { name: 'lookup' },
        parallelToolCalls: false,
        jsonSchema: { name: 'result', schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false } },
        maxTokens: 200,
        reasoningEffort: 'high',
        verbosity: 'low',
        promptCache: { policy: 'enabled', key: 'tenant-thread-42', retention: '24h' },
      }, 'test-key');

      assert.equal(requestUrl, 'https://api.openai.com/v1/responses');
      assert.equal(requestBody.instructions, 'Be precise.');
      assert.equal(requestBody.max_output_tokens, 200);
      assert.deepEqual(requestBody.tool_choice, { type: 'function', name: 'lookup' });
      assert.equal(requestBody.parallel_tool_calls, false);
      assert.deepEqual(requestBody.reasoning, { effort: 'high' });
      assert.equal(requestBody.text.format.type, 'json_schema');
      assert.equal(requestBody.text.format.strict, true);
      assert.equal(requestBody.text.verbosity, 'low');
      assert.equal(requestBody.prompt_cache_key, 'tenant-thread-42');
      assert.equal(requestBody.prompt_cache_retention, '24h');
      assert.ok(requestBody.input.some((item: any) => item.type === 'function_call' && item.call_id === 'call_1'));
      assert.ok(requestBody.input.some((item: any) => item.type === 'function_call_output' && item.call_id === 'call_1'));
      const user = requestBody.input.find((item: any) => item.role === 'user');
      assert.ok(user.content.some((part: any) => part.type === 'input_image' && part.image_url === 'data:image/png;base64,aW1hZ2U='));
      assert.equal(response.finishReason, 'tool_calls');
      assert.deepEqual(response.toolCalls, [{ id: 'call_2', name: 'lookup', arguments: { query: 'next' } }]);
      assert.deepEqual(response.usage, {
        inputTokens: 17,
        outputTokens: 5,
        cachedInputTokens: 7,
        reasoningTokens: 3,
        model: 'gpt-5-2026-06-01',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('streams Responses API text deltas and reads terminal usage', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      const events = [
        { type: 'response.output_text.delta', delta: 'Hello ' },
        { type: 'response.output_text.delta', delta: 'world' },
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello world' }] }],
            usage: { input_tokens: 9, output_tokens: 2 },
          },
        },
      ];
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as typeof fetch;
    const deltas: string[] = [];
    try {
      const response = await openaiProvider.chat({
        model: 'gpt-4.1',
        messages: [{ role: 'user', content: 'Hello' }],
        onDelta: (delta) => deltas.push(delta),
      }, 'test-key');
      assert.deepEqual(deltas, ['Hello ', 'world']);
      assert.equal(response.text, 'Hello world');
      assert.equal(response.finishReason, 'stop');
      assert.deepEqual(response.usage, {
        inputTokens: 9,
        outputTokens: 2,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        model: undefined,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('completes streamed function calls from the arguments.done event', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      const events = [
        { type: 'response.output_item.added', item: { id: 'item_1', type: 'function_call', call_id: 'call_1', name: 'lookup' } },
        { type: 'response.function_call_arguments.delta', item_id: 'item_1', delta: '{"q":' },
        { type: 'response.function_call_arguments.done', item_id: 'item_1', arguments: '{"q":"done"}' },
        { type: 'response.completed', response: { status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1 } } },
      ];
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch;
    try {
      const response = await openaiProvider.chat({ model: 'gpt-4.1', messages: [{ role: 'user', content: 'lookup' }], onDelta: () => {} }, 'key');
      assert.deepEqual(response.toolCalls, [{ id: 'call_1', name: 'lookup', arguments: { q: 'done' } }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('preserves structured API error code and parameter on HTTP failures', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      error: { message: 'Invalid value for model', type: 'invalid_request_error', code: 'model_not_found', param: 'model' },
    }), { status: 400, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    try {
      await assert.rejects(
        () => openaiProvider.chat({ model: 'gpt-4.1', messages: [{ role: 'user', content: 'hi' }] }, 'key'),
        (error: unknown) => {
          assert.equal((error as { status?: number }).status, 400);
          assert.match((error as Error).message, /HTTP 400: Invalid value for model \(model_not_found\) \[invalid_request_error\] param=model/);
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

it('rejects audio and video before calling the OpenAI Responses API', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('unexpected fetch');
  };
  try {
    await assert.rejects(
      () => openaiProvider.chat({
        model: 'gpt-5',
        messages: [{
          role: 'user',
          content: 'Describe this clip.',
          attachments: [{ name: 'clip.mp4', mimeType: 'video/mp4', dataBase64: 'dmlkZW8=', kind: 'video' }],
        }],
      }, 'key'),
      /does not support video attachments.*Responses adapter accepts image input/,
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
