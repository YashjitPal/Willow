import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import type { ProviderKeys } from '../src/domain/types.ts';
import { COLLECTIONS } from '../src/storage/index.ts';
import { VectorStoreService } from '../src/rag/vectorStore.ts';
import { makeApp, waitForRun } from './helpers.ts';
import { textPdf } from './fixtures.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('VectorStoreService', () => {
  it('rejects empty queries instead of returning arbitrary nearest chunks', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const store = await app.vectorStores.createStore('Query validation', undefined);
      await app.vectorStores.addFile(store.id, 'facts.txt', 'A useful fact.', undefined);
      await assert.rejects(
        app.vectorStores.search([store.id], '   ', undefined),
        /query must not be empty/,
      );
    } finally {
      await cleanup();
    }
  });

  it('extracts, indexes, and retrieves PDF content', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const store = await app.vectorStores.createStore('PDF knowledge', undefined);
      const bytes = textPdf('The PDF retrieval phrase is silver compass.');
      const file = await app.vectorStores.addFile(store.id, 'manual.pdf', bytes, undefined, 'application/pdf');
      assert.equal(file.status, 'ready');
      assert.equal(file.bytes, bytes.length);
      const results = await app.vectorStores.search([store.id], 'silver compass', undefined);
      assert.equal(results[0].filename, 'manual.pdf');
      assert.match(results[0].text, /silver compass/i);
    } finally {
      await cleanup();
    }
  });

  it('falls back to local embeddings when a remote embedder rejects ingestion', async () => {
    const { app, cleanup } = await makeApp();
    const keys: ProviderKeys = { openai: ['invalid-test-key'] };
    let remoteCalls = 0;

    globalThis.fetch = (async (input) => {
      remoteCalls += 1;
      assert.equal(String(input), 'https://api.openai.com/v1/embeddings');
      return new Response(JSON.stringify({ error: { message: 'invalid key' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const store = await app.vectorStores.createStore('Fallback knowledge', keys);
      assert.equal(store.embedder, 'openai');

      const file = await app.vectorStores.addFile(
        store.id,
        'facts.txt',
        'The retrieval phrase is cobalt lantern.',
        keys,
      );

      assert.equal(file.status, 'ready');
      assert.equal(remoteCalls, 1);

      const persisted = await app.vectorStores.getStore(store.id);
      assert.equal(persisted?.embedder, 'local');
      assert.equal(file.embeddingUsage?.length, 2);
      assert.equal(file.embeddingUsage?.[0].status, 'failed');
      assert.equal(file.embeddingUsage?.[0].tokenStatus, 'not_reported');
      assert.equal(file.embeddingUsage?.[0].pricing.status, 'unpriced');
      assert.equal(file.embeddingUsage?.[1].provider, 'local');
      assert.equal(persisted?.embeddingUsage?.ingestion.operations, 2);
      assert.equal(persisted?.embeddingUsage?.ingestion.unpricedOperations, 1);

      const results = await app.vectorStores.search([store.id], 'cobalt lantern', keys);
      assert.equal(remoteCalls, 1, 'search should reuse the persisted local embedding space');
      assert.equal(results.length, 1);
      assert.match(results[0].text, /cobalt lantern/i);
    } finally {
      await cleanup();
    }
  });

  it('cleans partial chunks when ingestion fails', async () => {
    const { app, cleanup } = await makeApp();
    const originalPut = app.storage.put.bind(app.storage);
    let chunkWrites = 0;
    try {
      const store = await app.vectorStores.createStore('Failure cleanup', undefined);
      app.storage.put = async (collection, id, doc, ref) => {
        if (collection === COLLECTIONS.vectorChunks && ++chunkWrites === 2) {
          throw new Error('simulated chunk persistence failure');
        }
        return originalPut(collection, id, doc, ref);
      };

      await assert.rejects(
        app.vectorStores.addFile(store.id, 'large.txt', 'separate paragraph\n\n'.repeat(500), undefined),
        /simulated chunk persistence failure/,
      );
      assert.equal(await app.storage.count(COLLECTIONS.vectorChunks, store.id), 0);
      const [file] = await app.vectorStores.listFiles(store.id);
      assert.equal(file.status, 'error');
      assert.equal(file.chunkCount, 0);
      const persisted = await app.vectorStores.getStore(store.id);
      assert.equal(persisted?.fileCount, 0);
      assert.equal(persisted?.chunkCount, 0);
    } finally {
      app.storage.put = originalPut;
      await cleanup();
    }
  });

  it('cancels remote ingestion without falling back or publishing chunks', async () => {
    const { app, cleanup } = await makeApp();
    const keys: ProviderKeys = { openai: ['abort-test-key'] };
    const controller = new AbortController();
    let remoteCalls = 0;
    globalThis.fetch = (async (_input, init) => {
      remoteCalls++;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    }) as typeof fetch;

    try {
      const store = await app.vectorStores.createStore('Cancelled ingestion', keys);
      const reason = new Error('user cancelled ingestion');
      const ingestion = app.vectorStores.addFile(
        store.id,
        'facts.txt',
        'This content must never become searchable.',
        keys,
        'text/plain',
        controller.signal,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      controller.abort(reason);
      await assert.rejects(ingestion, /request aborted/);
      assert.equal(remoteCalls, 1);
      assert.equal((await app.vectorStores.getStore(store.id))?.embedder, 'openai');
      assert.equal(await app.storage.count(COLLECTIONS.vectorChunks, store.id), 0);
      assert.equal((await app.vectorStores.listFiles(store.id))[0].status, 'cancelled');
      const cancelledFile = (await app.vectorStores.listFiles(store.id))[0];
      assert.equal(cancelledFile.embeddingUsage?.[0].status, 'cancelled');
      assert.equal(cancelledFile.embeddingUsage?.[0].inputTokens, undefined);
      assert.equal(cancelledFile.embeddingUsage?.[0].pricing.status, 'unpriced');
    } finally {
      await cleanup();
    }
  });

  it('persists provider-reported embedding tokens and frozen cost for ingestion and search', async () => {
    const { app, cleanup } = await makeApp();
    const keys: ProviderKeys = { openai: ['usage-test-key'] };
    let call = 0;
    globalThis.fetch = (async () => {
      const promptTokens = call++ === 0 ? 12 : 3;
      return new Response(JSON.stringify({
        data: [{ index: 0, embedding: new Array(1536).fill(0).map((_, index) => index === 0 ? 1 : 0) }],
        usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      const store = await app.vectorStores.createStore('Usage accounting', keys);
      const file = await app.vectorStores.addFile(store.id, 'usage.txt', 'provider reported token usage', keys);
      assert.equal(file.embeddingUsage?.[0].inputTokens, 12);
      assert.equal(file.embeddingUsage?.[0].pricing.status, 'priced');
      assert.equal(file.embeddingUsage?.[0].pricing.estimatedCostUsd, 0.00000024);

      const runUsage: import('../src/domain/types.ts').EmbeddingOperationUsage[] = [];
      await app.vectorStores.search([store.id], 'reported', keys, { onEmbeddingUsage: (usage) => runUsage.push(usage) });
      assert.equal(runUsage.length, 1);
      assert.equal(runUsage[0].operation, 'search');
      assert.equal(runUsage[0].inputTokens, 3);
      assert.equal(runUsage[0].pricing.estimatedCostUsd, 0.00000006);
      const persisted = await app.vectorStores.getStore(store.id);
      assert.equal(persisted?.embeddingUsage?.ingestion.reportedInputTokens, 12);
      assert.equal(persisted?.embeddingUsage?.ingestion.estimatedCostUsd, 0.00000024);
      assert.equal(persisted?.embeddingUsage?.search.reportedInputTokens, 3);
      assert.equal(persisted?.embeddingUsage?.search.estimatedCostUsd, 0.00000006);
    } finally {
      await cleanup();
    }
  });

  it('attributes file-search embedding usage to the workflow run', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const store = await app.vectorStores.createStore('Run accounting', undefined);
      await app.vectorStores.addFile(store.id, 'facts.txt', 'the launch code is willow', undefined);
      const { workflow } = await app.workflows.create({
        name: 'Embedding usage run',
        graph: {
          nodes: [
            { id: 's', type: 'start', data: {} },
            { id: 'f', type: 'fileSearch', config: { vectorStoreIds: [store.id], query: 'launch code' } },
            { id: 'e', type: 'end', config: { output: 'done' } },
          ],
          edges: [{ id: 'sf', source: 's', target: 'f' }, { id: 'fe', source: 'f', target: 'e' }],
        },
      });
      const started = await app.engine.createRun({ workflowId: workflow.id, input: {} });
      const run = await waitForRun(app, started.id, ['completed', 'failed']);
      assert.equal(run.status, 'completed', run.error);
      assert.equal(run.usage.embeddingOperations, 1);
      assert.equal(run.usage.embeddingInputTokens, 0);
      assert.equal(run.usage.unpricedEmbeddingOperations, 0);
      assert.deepEqual(run.usage.byEmbeddingModel['local:local-hash-512'], {
        provider: 'local', model: 'local-hash-512', inputTokens: 0, operations: 1,
        unreportedTokenOperations: 0,
        pricing: { status: 'priced', catalogVersion: run.usage.pricingCatalogVersion, currency: 'USD', inputUsdPerMillion: 0, estimatedCostUsd: 0 },
      });
    } finally {
      await cleanup();
    }
  });

  it('keeps store counts correct across concurrent additions', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const store = await app.vectorStores.createStore('Concurrent files', undefined);
      const files = await Promise.all(Array.from({ length: 8 }, (_, index) => (
        app.vectorStores.addFile(store.id, `file-${index}.txt`, `unique fact ${index}`, undefined)
      )));
      assert.equal(files.filter((file) => file.status === 'ready').length, 8);
      const persisted = await app.vectorStores.getStore(store.id);
      assert.equal(persisted?.fileCount, 8);
      assert.equal(persisted?.chunkCount, 8);
      assert.equal(persisted?.embeddingUsage?.ingestion.operations, 8);
      assert.equal(persisted?.embeddingUsage?.ingestion.requestCount, 0);
      assert.equal(await app.storage.count(COLLECTIONS.vectorChunks, store.id), 8);
    } finally {
      await cleanup();
    }
  });

  it('returns queued uploads immediately and recovers them from durable source bytes', async () => {
    const { app, cleanup } = await makeApp();
    const recoveredService = new VectorStoreService(app.storage, app.config.dataDir);
    try {
      const store = await app.vectorStores.createStore('Recovered upload', undefined);
      const fileId = 'vsf_recovery_test';
      const createdAt = new Date().toISOString();
      await app.storage.put(COLLECTIONS.vectorFiles, fileId, {
        id: fileId,
        storeId: store.id,
        filename: 'recovered.txt',
        bytes: 39,
        chunkCount: 0,
        status: 'processing',
        stage: 'queued',
        processedUnits: 0,
        totalUnits: 0,
        mimeType: 'text/plain',
        createdAt,
        updatedAt: createdAt,
      }, store.id);
      const uploadDir = path.join(app.config.dataDir, 'uploads');
      await fs.mkdir(uploadDir, { recursive: true });
      await fs.writeFile(path.join(uploadDir, `${fileId}.bin`), 'The recovery phrase is amber telescope.');

      assert.equal(await recoveredService.recoverPendingIngestions(undefined), 1);
      let file = await recoveredService.getFile(store.id, fileId);
      for (let attempt = 0; attempt < 100 && file?.status === 'processing'; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        file = await recoveredService.getFile(store.id, fileId);
      }
      assert.equal(file?.status, 'ready');
      assert.equal(file?.stage, 'completed');
      assert.equal(file?.processedUnits, file?.totalUnits);
      const results = await recoveredService.search([store.id], 'amber telescope', undefined);
      assert.equal(results[0].fileId, fileId);
    } finally {
      await recoveredService.close();
      await cleanup();
    }
  });

  it('preserves an in-flight upload for recovery across graceful shutdown', async () => {
    const { app, cleanup } = await makeApp();
    const keys: ProviderKeys = { openai: ['restart-test-key'] };
    const recoveredService = new VectorStoreService(app.storage, app.config.dataDir);
    let embeddingStarted!: () => void;
    const started = new Promise<void>((resolve) => { embeddingStarted = resolve; });
    globalThis.fetch = ((_input, init) => {
      embeddingStarted();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    }) as typeof fetch;

    try {
      const store = await app.vectorStores.createStore('Graceful restart', keys);
      const file = await app.vectorStores.enqueueFile(
        store.id,
        'restart.txt',
        'The graceful restart phrase is violet sextant.',
        keys,
      );
      await started;
      await app.vectorStores.close();

      const paused = await app.vectorStores.getFile(store.id, file.id);
      assert.equal(paused?.status, 'processing');
      assert.equal(paused?.stage, 'queued');
      await fs.access(path.join(app.config.dataDir, 'uploads', `${file.id}.bin`));

      globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'expired after restart' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
      assert.equal(await recoveredService.recoverPendingIngestions(keys), 1);
      let recovered = await recoveredService.getFile(store.id, file.id);
      for (let attempt = 0; attempt < 100 && recovered?.status === 'processing'; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        recovered = await recoveredService.getFile(store.id, file.id);
      }
      assert.equal(recovered?.status, 'ready');
      const results = await recoveredService.search([store.id], 'violet sextant', undefined);
      assert.equal(results[0].fileId, file.id);
    } finally {
      await recoveredService.close();
      await cleanup();
    }
  });
});
