import assert from 'node:assert/strict';
import test from 'node:test';
import { getUsageCostDisplay, getUsageDetailItems, getUsageEmbeddingBreakdown, getUsageModelBreakdown, getUsageUnpricedCallCount } from './agentUsageDisplay.ts';

test('legacy usage has no fabricated cost', () => {
  assert.equal(getUsageCostDisplay({ inputTokens: 12, outputTokens: 4 }), null);
});

test('priced zero remains distinct from missing pricing', () => {
  assert.deepEqual(getUsageCostDisplay({ estimatedCostUsd: 0 }), {
    value: '$0.00', detail: undefined, status: 'priced',
  });
});

test('partial pricing reports excluded calls', () => {
  assert.deepEqual(getUsageCostDisplay({ estimatedCostUsd: 0.0123, unpricedLlmCalls: 2 }), {
    value: 'At least $0.0123', detail: '2 model calls without pricing not included in this estimate', status: 'partial',
  });
});

test('unpriced usage never appears as zero cost', () => {
  assert.deepEqual(getUsageCostDisplay({
    estimatedCostUsd: 0,
    unpricedLlmCalls: 1,
    byModel: { custom: { llmCalls: 1, pricing: { status: 'unpriced' } } },
  }), {
    value: 'Unpriced', detail: '1 model call without pricing', status: 'unpriced',
  });
});

test('token details support normalized and nested fields', () => {
  assert.deepEqual(getUsageDetailItems({
    byModel: {
      'openai/gpt': { cachedInputTokens: 20, reasoningTokens: 8, cacheWriteInputTokens: 3 },
    },
  }), [
    { label: 'Cached input', value: 20 },
    { label: 'Cache write', value: 3 },
    { label: 'Reasoning', value: 8 },
  ]);
});

test('unpriced model calls are inferred from rich buckets', () => {
  assert.deepEqual(getUsageCostDisplay({
    estimatedCostUsd: 0.02,
    byModel: { custom: { model: 'custom/model', llmCalls: 2, pricing: { status: 'unpriced' } } },
  }), {
    value: 'Unpriced', detail: '2 model calls without pricing', status: 'unpriced',
  });
});

test('model breakdown preserves pricing and token categories', () => {
  assert.deepEqual(getUsageModelBreakdown({
    byModel: {
      'openai/gpt': {
        provider: 'openai', model: 'openai/gpt', llmCalls: 2, inputTokens: 100,
        outputTokens: 40, cachedInputTokens: 20, cacheWriteInputTokens: 3, reasoningTokens: 8,
        pricing: { status: 'priced', estimatedCostUsd: 0.0123 },
      },
    },
  }), [{
    key: 'openai/gpt', model: 'openai/gpt', provider: 'openai', llmCalls: 2,
    inputTokens: 100, outputTokens: 40, cachedInputTokens: 20, cacheWriteInputTokens: 3,
    reasoningTokens: 8, estimatedCostUsd: 0.0123, pricingStatus: 'priced',
  }]);
});

test('unpriced call count prefers explicit aggregate accounting', () => {
  assert.equal(getUsageUnpricedCallCount({ unpricedModelCalls: 3, byModel: { custom: { llmCalls: 1, pricing: { status: 'unpriced' } } } }), 3);
  assert.equal(getUsageUnpricedCallCount({ byModel: { custom: { llmCalls: 2, pricing: { status: 'unpriced' } } } }), 2);
});

test('embedding usage is visible and affects partial cost wording', () => {
  assert.deepEqual(getUsageDetailItems({ embeddingInputTokens: 321, embeddingOperations: 2 }), [
    { label: 'Embedding input', value: 321 },
    { label: 'Embedding searches', value: 2 },
  ]);
  assert.deepEqual(getUsageCostDisplay({ estimatedCostUsd: 0.01, unpricedEmbeddingOperations: 1 }), {
    value: 'At least $0.01',
    detail: '1 embedding operation without pricing not included in this estimate',
    status: 'partial',
  });
});

test('embedding model breakdown preserves pricing provenance', () => {
  assert.deepEqual(getUsageEmbeddingBreakdown({
    byEmbeddingModel: {
      'openai/text-embedding': {
        provider: 'openai', model: 'text-embedding', operations: 3, inputTokens: 250,
        unreportedTokenOperations: 1, pricing: { status: 'priced', estimatedCostUsd: 0.00001 },
      },
    },
  }), [{
    key: 'openai/text-embedding', provider: 'openai', model: 'text-embedding', operations: 3,
    inputTokens: 250, unreportedTokenOperations: 1, estimatedCostUsd: 0.00001, pricingStatus: 'priced',
  }]);
});
