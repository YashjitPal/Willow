import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGeminiEmbedder, createOpenAiEmbedder } from '../src/rag/embeddings.ts';

describe('embedding cancellation', () => {
  it('marks Gemini embedding tokens unreported and cost unpriced', async () => {
    const transport = async () => new Response(JSON.stringify({ embeddings: [{ values: [1, 0] }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const result = await createGeminiEmbedder('test-key', transport).embed(['hello']);
    assert.equal(result.usage.inputTokens, undefined);
    assert.equal(result.usage.tokenStatus, 'not_reported');
    assert.equal(result.usage.pricing.status, 'unpriced');
  });

  it('aborts an in-flight remote embedding request', async () => {
    const transport = (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) reject(signal.reason);
      else signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    const controller = new AbortController();
    const pending = createOpenAiEmbedder('test-key', transport).embed(['cancel me'], controller.signal);
    controller.abort(new Error('run cancelled'));
    await assert.rejects(pending, /run cancelled|request aborted/);
  });

  it('isolates concurrent embedders to their own network transports', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = createOpenAiEmbedder('first-key', async (_url, init) => {
      await firstGate;
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer first-key');
      return new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }], usage: { prompt_tokens: 1 } }), { status: 200 });
    });
    const second = createOpenAiEmbedder('second-key', async (_url, init) => {
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer second-key');
      return new Response(JSON.stringify({ data: [{ index: 0, embedding: [0, 1] }], usage: { prompt_tokens: 2 } }), { status: 200 });
    });

    const firstPending = first.embed(['first']);
    const secondResult = await second.embed(['second']);
    releaseFirst();
    const firstResult = await firstPending;

    assert.deepEqual(firstResult.vectors, [[1, 0]]);
    assert.deepEqual(secondResult.vectors, [[0, 1]]);
    assert.equal(firstResult.usage.inputTokens, 1);
    assert.equal(secondResult.usage.inputTokens, 2);
  });
});
