import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { priceModelUsage, PRICING_CATALOG_VERSION } from '../src/services/pricing.ts';
import { usageFromModelResponse } from '../src/services/evaluations.ts';
import { makeApp, waitForRun, type App } from './helpers.ts';

describe('usage pricing snapshots', () => {
  it('marks known models unpriced when the provider did not report usage', () => {
    assert.deepEqual(priceModelUsage({
      provider: 'mock',
      model: 'mock/upper',
      inputTokens: 0,
      outputTokens: 0,
      tokenStatus: 'not_reported',
    }), {
      status: 'unpriced',
      catalogVersion: PRICING_CATALOG_VERSION,
      currency: 'USD',
    });
  });

  it('marks unknown models unpriced instead of reporting zero cost', () => {
    assert.deepEqual(priceModelUsage({
      provider: 'openai',
      model: 'future-model',
      inputTokens: 100,
      outputTokens: 20,
    }), {
      status: 'unpriced',
      catalogVersion: PRICING_CATALOG_VERSION,
      currency: 'USD',
    });
  });

  it('keeps missing provider usage unpriced in evaluation accounting', () => {
    const usage = usageFromModelResponse({
      provider: 'mock',
      model: 'mock/json',
      inputTokens: 0,
      outputTokens: 0,
      tokenStatus: 'not_reported',
    }, 'mock/json');

    assert.equal(usage.modelCalls, 1);
    assert.equal(usage.unpricedLlmCalls, 1);
    assert.equal(usage.unpricedModelCalls, 1);
    assert.equal(usage.estimatedCostUsd, 0);
    assert.deepEqual(usage.byModel['mock:mock/json'].pricing, {
      status: 'unpriced',
      catalogVersion: PRICING_CATALOG_VERSION,
      currency: 'USD',
    });
  });
});

describe('run usage accounting', () => {
  let app: App;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ app, cleanup } = await makeApp());
  });
  after(async () => cleanup());

  it('persists per-model usage and its pricing snapshot', async () => {
    const { workflow } = await app.workflows.create({
      name: 'usage accounting',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'a', type: 'agent', config: { instructions: '', model: 'mock/upper', tools: [], outputFormat: 'text', includeChatHistory: false, writeToConversationHistory: false, continueOnError: false } },
          { id: 'e', type: 'end', data: {} },
        ],
        edges: [
          { id: 'sa', source: 's', target: 'a' },
          { id: 'ae', source: 'a', target: 'e' },
        ],
      },
    });
    const created = await app.engine.createRun({
      workflowId: workflow.id,
      input: { input_as_text: 'price me' },
    });
    const run = await waitForRun(app, created.id, ['completed', 'failed']);

    assert.equal(run.status, 'completed', run.error);
    assert.equal(run.usage.pricingCatalogVersion, PRICING_CATALOG_VERSION);
    assert.equal(run.usage.unpricedLlmCalls, 0);
    assert.equal(run.usage.estimatedCostUsd, 0);
    assert.deepEqual(run.usage.byModel['mock:mock/upper'], {
      provider: 'mock',
      model: 'mock/upper',
      inputTokens: 8,
      outputTokens: 16,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningTokens: 0,
      llmCalls: 1,
      pricing: {
        status: 'priced',
        catalogVersion: PRICING_CATALOG_VERSION,
        currency: 'USD',
        inputUsdPerMillion: 0,
        outputUsdPerMillion: 0,
        estimatedCostUsd: 0,
      },
    });
  });
});
