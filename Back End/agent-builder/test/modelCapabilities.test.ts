import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertInputAttachmentSupport,
  inputModalitiesForModel,
  providerForKnownModel,
  providerForModel,
} from '../src/providers/types.ts';
import { geminiProvider } from '../src/providers/gemini.ts';
import { openaiProvider } from '../src/providers/openai.ts';

describe('model input capability metadata', () => {
  it('never guesses a provider for an unknown model id', () => {
    assert.equal(providerForKnownModel('vendor-mystery-1'), undefined);
    assert.throws(() => providerForModel('vendor-mystery-1'), /will not guess its provider/);
    assert.equal(providerForModel('models/gemini-2.5-flash'), 'gemini');
    assert.equal(providerForModel('glm-4.5'), 'glm');
    assert.equal(providerForModel('chatglm-6b'), 'glm');
  });
  it('reports conservative provider and model specific modalities', () => {
    assert.deepEqual(inputModalitiesForModel('gemini', 'gemini-3-flash'), ['text', 'image', 'audio', 'video']);
    assert.deepEqual(inputModalitiesForModel('gemini', 'gemini-pro'), ['text']);
    assert.deepEqual(inputModalitiesForModel('openai', 'gpt-4.1-mini'), ['text', 'image']);
    assert.deepEqual(inputModalitiesForModel('openai', 'gpt-3.5-turbo'), ['text']);
    assert.deepEqual(inputModalitiesForModel('anthropic', 'claude-sonnet-4-20250514'), ['text', 'image']);
    assert.deepEqual(inputModalitiesForModel('anthropic', 'claude-2.1'), ['text']);
    assert.deepEqual(inputModalitiesForModel('mock', 'mock/echo'), ['text']);
    assert.deepEqual(inputModalitiesForModel('glm', 'glm-4.5'), ['text']);
  });

  it('uses the same metadata to reject unsupported media before provider calls', () => {
    assert.throws(
      () => assertInputAttachmentSupport('openai', 'gpt-3.5-turbo', [{
        role: 'user',
        content: 'Describe this.',
        attachments: [{ name: 'pixel.png', mimeType: 'image/png', dataBase64: 'aW1hZ2U=', kind: 'image' }],
      }]),
      /select a vision-capable OpenAI model/,
    );
    assert.doesNotThrow(() => assertInputAttachmentSupport('gemini', 'gemini-2.5-flash', [{
      role: 'user',
      content: 'Describe this.',
      attachments: [{ name: 'clip.mp4', mimeType: 'video/mp4', dataBase64: 'dmlkZW8=', kind: 'video' }],
    }]));
  });

  it('preserves provider-reported Gemini token limits and provenance', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ models: [{
      name: 'models/gemini-test', displayName: 'Gemini Test',
      supportedGenerationMethods: ['generateContent'], inputTokenLimit: 123456, outputTokenLimit: 7890,
    }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    try {
      const models = await geminiProvider.listModels('test-key');
      assert.equal(models[0]?.contextWindowTokens, 123456);
      assert.equal(models[0]?.maxOutputTokens, 7890);
      assert.equal(models[0]?.limitsSource, 'provider');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('paginates Gemini discovery and returns deterministic model ordering', async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      const secondPage = new URL(url).searchParams.get('pageToken') === 'next page';
      return new Response(JSON.stringify(secondPage ? { models: [{
        name: 'models/gemini-a', displayName: 'Alpha', supportedGenerationMethods: ['generateContent'],
      }] } : { models: [{
        name: 'models/gemini-z', displayName: 'Zulu', supportedGenerationMethods: ['generateContent'],
      }], nextPageToken: 'next page' }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      const models = await geminiProvider.listModels('test key');
      assert.deepEqual(models.map((model) => model.id), ['gemini-a', 'gemini-z']);
      assert.equal(urls.length, 2);
      assert.equal(new URL(urls[1]!).searchParams.get('pageToken'), 'next page');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('paginates OpenAI model discovery using the documented after cursor', async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      const secondPage = new URL(url).searchParams.get('after') === 'page-one-last';
      return new Response(JSON.stringify(secondPage
        ? { data: [{ id: 'gpt-5-mini' }], has_more: false, last_id: 'page-two-last' }
        : { data: [{ id: 'gpt-4.1' }], has_more: true, last_id: 'page-one-last' }),
      { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      const models = await openaiProvider.listModels('test-key');
      assert.deepEqual(models.map((model) => model.id), ['gpt-4.1', 'gpt-5-mini']);
      assert.equal(urls.length, 2);
      assert.equal(new URL(urls[1]!).searchParams.get('after'), 'page-one-last');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
