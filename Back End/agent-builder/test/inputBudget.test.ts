import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pinnedModelTokenLimits } from '../src/domain/modelCapabilities.ts';
import { compactMessagesForInputBudget } from '../src/engine/inputBudget.ts';
import { getProvider } from '../src/providers/index.ts';
import type { LLMMessage, LLMRequest } from '../src/providers/types.ts';

const units = (body: unknown) => new TextEncoder().encode(JSON.stringify(body)).byteLength;

describe('model token limits', () => {
  it('pins only exact repository-controlled model ids', () => {
    assert.equal(pinnedModelTokenLimits('mock/echo').limitsSource, 'pinned');
    assert.equal(pinnedModelTokenLimits('mock/echo').maxOutputTokens, 1_000_000);
    assert.deepEqual(pinnedModelTokenLimits('gpt-5'), { limitsSource: 'unknown' });
    assert.deepEqual(pinnedModelTokenLimits('claude-sonnet-4-20250514'), { limitsSource: 'unknown' });
  });
});

describe('provider-envelope input compaction', () => {
  const messages: LLMMessage[] = [
    { role: 'system', content: 'protected instructions' },
    { role: 'user', content: 'old user '.repeat(40) },
    { role: 'assistant', content: 'old answer '.repeat(40) },
    { role: 'user', content: 'current user' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'old_call', name: 'lookup', arguments: { secret: 'not traced' } }] },
    { role: 'tool', content: 'old tool result '.repeat(30), toolCallId: 'old_call', name: 'lookup' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'latest_call', name: 'lookup', arguments: {} }] },
    { role: 'tool', content: 'latest result', toolCallId: 'latest_call', name: 'lookup' },
  ];

  it('removes oldest groups atomically using the final provider body without mutating history', () => {
    const provider = getProvider('mock');
    const base: Omit<LLMRequest, 'messages'> = { model: 'mock/echo', tools: [{ name: 'lookup' }], toolChoice: 'auto' };
    const measure = (candidate: LLMMessage[]) => units(provider.prepareRequestBody({ ...base, messages: candidate }));
    const protectedOnly = messages.filter((_, index) => [0, 3, 4, 5, 6, 7].includes(index));
    const result = compactMessagesForInputBudget(messages, measure, measure(protectedOnly));

    assert.deepEqual(result.messages, protectedOnly);
    assert.equal(result.metadata.removedMessages, 2);
    assert.equal(result.metadata.removedGroups, 1);
    assert.equal(messages.length, 8, 'durable loop state must remain unchanged');
    assert.ok(result.metadata.beforeUnits > result.metadata.afterUnits);
  });

  it('protects older attachment turns and the complete latest user-led turn', () => {
    const candidate: LLMMessage[] = [
      { role: 'user', content: 'removable' }, { role: 'assistant', content: 'removable answer' },
      { role: 'user', content: 'attachment', attachments: [{ name: 'x.png', mimeType: 'image/png', dataBase64: 'eA==', kind: 'image' }] }, { role: 'assistant', content: 'attachment answer' },
      { role: 'user', content: 'latest' }, { role: 'assistant', content: '', toolCalls: [{ id: 'c', name: 'tool', arguments: {} }] }, { role: 'tool', content: 'result', toolCallId: 'c', name: 'tool' },
    ];
    const measure = (value: LLMMessage[]) => units(value);
    const protectedOnly = candidate.slice(2);
    const result = compactMessagesForInputBudget(candidate, measure, measure(protectedOnly));
    assert.deepEqual(result.messages, protectedOnly);
  });

  it('protects the latest complete tool transaction when no user message exists', () => {
    const candidate: LLMMessage[] = [
      { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'tool', arguments: {} }] }, { role: 'tool', content: 'old', toolCallId: 'a', name: 'tool' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'b', name: 'tool', arguments: {} }] }, { role: 'tool', content: 'latest', toolCallId: 'b', name: 'tool' },
    ];
    const measure = (value: LLMMessage[]) => units(value);
    const result = compactMessagesForInputBudget(candidate, measure, measure(candidate.slice(2)));
    assert.deepEqual(result.messages, candidate.slice(2));
  });

  it('fails before a provider call when protected content alone exceeds the cap', () => {
    const provider = getProvider('openai');
    const measure = (candidate: LLMMessage[]) => units(provider.prepareRequestBody({ model: 'gpt-5', messages: candidate, maxTokens: 100 }));
    assert.throws(
      () => compactMessagesForInputBudget([
        { role: 'system', content: 'instructions'.repeat(20) },
        { role: 'user', content: 'current'.repeat(20), attachments: [{ name: 'image.png', mimeType: 'image/png', dataBase64: 'a'.repeat(100), kind: 'image' }] },
      ], measure, 10),
      /protected model input requires/,
    );
  });
});
