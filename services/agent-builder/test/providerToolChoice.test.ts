import assert from 'node:assert/strict';
import { it } from 'node:test';
import { anthropicProvider } from '../src/providers/anthropic.ts';
import { geminiProvider } from '../src/providers/gemini.ts';
import { openaiProvider } from '../src/providers/openai.ts';

it('maps OpenAI Responses image input as input_image data URLs and keeps system instructions separate', async () => {
  const originalFetch = globalThis.fetch;
  let body: any;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify({
      id: 'resp_test', model: 'gpt-4.1', status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
      usage: { input_tokens: 9, output_tokens: 1 },
    }), { status: 200 });
  };
  try {
    const result = await openaiProvider.chat({
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'What is this?', attachments: [{ name: 'pixel.png', mimeType: 'image/png', dataBase64: 'aW1hZ2U=', kind: 'image' }] },
      ],
    }, 'key');
    assert.equal(body.instructions, 'Be concise.');
    assert.deepEqual(body.input, [{ role: 'user', content: [
      { type: 'input_text', text: 'What is this?' },
      { type: 'input_image', image_url: 'data:image/png;base64,aW1hZ2U=' },
    ] }]);
    assert.equal(result.text, 'ok');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it('rejects non-image OpenAI attachments before making a request', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{}'); };
  try {
    await assert.rejects(
      () => openaiProvider.chat({ model: 'gpt-4.1', messages: [{ role: 'user', content: 'Listen', attachments: [{ name: 'clip.mp3', mimeType: 'audio/mpeg', dataBase64: 'YQ==', kind: 'audio' }] }] }, 'key'),
      /does not support audio attachments.*Responses adapter accepts image input only/,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it('maps tool choice and normalizes Gemini and Anthropic usage', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: any[] = [];
  let call = 0;
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body ?? '{}')));
    call += 1;
    return call === 1
      ? new Response(JSON.stringify({
          modelVersion: 'models/gemini-3-flash-001',
          candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 3, thoughtsTokenCount: 2, cachedContentTokenCount: 4 },
        }), { status: 200 })
      : new Response(JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
        }), { status: 200 });
  };
  const request = {
    messages: [{ role: 'user' as const, content: 'Use lookup', attachments: [{ name: 'pixel.png', mimeType: 'image/png', dataBase64: 'aW1hZ2U=' }] }],
    tools: [{ name: 'lookup', parameters: { type: 'object' as const, properties: {} } }],
    toolChoice: { name: 'lookup' },
    parallelToolCalls: false,
  };
  try {
    const gemini = await geminiProvider.chat({ ...request, model: 'gemini-3-flash' }, 'key');
    const anthropic = await anthropicProvider.chat({
      ...request,
      model: 'claude-sonnet-4',
      messages: [{ role: 'system', content: 'Cache these instructions.' }, ...request.messages],
      promptCache: { policy: 'enabled', retention: '1h' },
    }, 'key');
    assert.deepEqual(bodies[0].toolConfig, { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['lookup'] } });
    assert.deepEqual(bodies[1].tool_choice, { type: 'tool', name: 'lookup', disable_parallel_tool_use: true });
    assert.deepEqual(bodies[1].system, [{ type: 'text', text: 'Cache these instructions.', cache_control: { type: 'ephemeral', ttl: '1h' } }]);
    assert.deepEqual(bodies[0].contents[0].parts[1], { inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } });
    assert.deepEqual(bodies[1].messages[0].content[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } });
    assert.deepEqual(gemini.usage, {
      inputTokens: 11,
      outputTokens: 5,
      cachedInputTokens: 4,
      reasoningTokens: 2,
      model: 'gemini-3-flash-001',
    });
    assert.deepEqual(anthropic.usage, {
      inputTokens: 10,
      outputTokens: 2,
      cachedInputTokens: 3,
      cacheWriteInputTokens: 2,
      model: 'claude-sonnet-4-20250514',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it('maps audio and video to Gemini inline data and rejects them for Anthropic', async () => {
  const originalFetch = globalThis.fetch;
  let body: any;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    body = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify({
      modelVersion: 'models/gemini-3-flash-001',
      candidates: [{ content: { parts: [{ text: 'described' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1 },
    }), { status: 200 });
  };
  const messages = [{
    role: 'user' as const,
    content: 'Describe both files.',
    attachments: [
      { name: 'sample.mp3', mimeType: 'audio/mpeg', dataBase64: 'YXVkaW8=', kind: 'audio' as const },
      { name: 'clip.mp4', mimeType: 'video/mp4', dataBase64: 'dmlkZW8=', kind: 'video' as const },
    ],
  }];
  try {
    const response = await geminiProvider.chat({ model: 'gemini-3-flash', messages }, 'key');
    assert.equal(response.text, 'described');
    assert.deepEqual(body.contents[0].parts.slice(1), [
      { inlineData: { mimeType: 'audio/mpeg', data: 'YXVkaW8=' } },
      { inlineData: { mimeType: 'video/mp4', data: 'dmlkZW8=' } },
    ]);
    await assert.rejects(
      () => anthropicProvider.chat({ model: 'claude-sonnet-4', messages }, 'key'),
      /does not support audio and video attachments.*use a Gemini multimodal model/,
    );
    assert.equal(calls, 1, 'Anthropic capability errors must occur before a network request');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it('preserves Gemini tool-call ids across parallel calls and tool results', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: any[] = [];
  let call = 0;
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body ?? '{}')));
    call += 1;
    return new Response(JSON.stringify(call === 1 ? {
      modelVersion: 'models/gemini-3-flash-001',
      candidates: [{
        content: {
          parts: [
            { functionCall: { id: 'provider_call_a', name: 'lookup', args: { query: 'alpha' } } },
            { functionCall: { id: 'provider_call_b', name: 'lookup', args: { query: 'beta' } } },
          ],
        },
        finishReason: 'STOP',
      }],
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 },
    } : {
      modelVersion: 'models/gemini-3-flash-001',
      candidates: [{ content: { parts: [{ text: 'combined' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 1 },
    }), { status: 200 });
  };

  try {
    const first = await geminiProvider.chat({
      model: 'gemini-3-flash',
      messages: [{ role: 'user', content: 'Look up both.' }],
      tools: [{ name: 'lookup', parameters: { type: 'object', properties: { query: { type: 'string' } } } }],
      parallelToolCalls: true,
    }, 'key');
    assert.deepEqual(first.toolCalls, [
      { id: 'provider_call_a', name: 'lookup', arguments: { query: 'alpha' } },
      { id: 'provider_call_b', name: 'lookup', arguments: { query: 'beta' } },
    ]);

    await geminiProvider.chat({
      model: 'gemini-3-flash',
      messages: [
        { role: 'user', content: 'Look up both.' },
        { role: 'assistant', content: '', toolCalls: first.toolCalls },
        { role: 'tool', toolCallId: 'provider_call_a', name: 'lookup', content: '{"value":"A"}' },
        { role: 'tool', toolCallId: 'provider_call_b', name: 'lookup', content: '{"value":"B"}' },
      ],
      tools: [{ name: 'lookup' }],
    }, 'key');

    assert.deepEqual(bodies[1].contents.slice(1), [
      { role: 'model', parts: [
        { functionCall: { id: 'provider_call_a', name: 'lookup', args: { query: 'alpha' } } },
        { functionCall: { id: 'provider_call_b', name: 'lookup', args: { query: 'beta' } } },
      ] },
      { role: 'user', parts: [{ functionResponse: { id: 'provider_call_a', name: 'lookup', response: { value: 'A' } } }] },
      { role: 'user', parts: [{ functionResponse: { id: 'provider_call_b', name: 'lookup', response: { value: 'B' } } }] },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
