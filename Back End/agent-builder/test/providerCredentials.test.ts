import assert from 'node:assert/strict';
import test from 'node:test';
import { chatWithModel, resolveKeys } from '../src/providers/index.ts';
import { openaiProvider } from '../src/providers/openai.ts';
import { ProviderError, type LLMRequest } from '../src/providers/types.ts';

const request: LLMRequest = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hello' }] };

test('resolveKeys preserves ordered request candidates and trims/deduplicates them', () => {
  assert.deepEqual(resolveKeys('openai', { openai: [' first ', '', 'second', 'first'] }, { openai: ['stored'] }), ['first', 'second']);
  assert.deepEqual(resolveKeys('openai', undefined, { openai: [' stored ', 'stored'] }), ['stored']);
});

test('chatWithModel fails over only after authentication rejection', async () => {
  const original = openaiProvider.chat;
  const seen: string[] = [];
  openaiProvider.chat = async (_req, key) => {
    seen.push(key);
    if (key === 'bad') throw new ProviderError('openai', 'unauthorized', 401);
    return { text: 'ok', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
  };
  try {
    const result = await chatWithModel(request, { openai: ['bad', 'good'] }, undefined);
    assert.equal(result.text, 'ok');
    assert.deepEqual(seen, ['bad', 'good']);
  } finally { openaiProvider.chat = original; }
});

for (const status of [429, 500, 503]) {
  test(`does not rotate credentials for HTTP ${status}`, async () => {
    const original = openaiProvider.chat;
    const seen: string[] = [];
    openaiProvider.chat = async (_req, key) => {
      seen.push(key);
      throw new ProviderError('openai', `HTTP ${status}`, status);
    };
    try {
      await assert.rejects(() => chatWithModel(request, { openai: ['first', 'second'] }, undefined), (error: unknown) => error instanceof ProviderError && error.status === status);
      assert.deepEqual(seen, ['first']);
    } finally { openaiProvider.chat = original; }
  });
}

test('does not rotate credentials for timeouts or transport errors', async () => {
  const original = openaiProvider.chat;
  const seen: string[] = [];
  openaiProvider.chat = async (_req, key) => { seen.push(key); throw new ProviderError('openai', 'request timed out or aborted'); };
  try {
    await assert.rejects(() => chatWithModel(request, { openai: ['first', 'second'] }, undefined));
    assert.deepEqual(seen, ['first']);
  } finally { openaiProvider.chat = original; }
});
