import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { COLLECTIONS } from '../src/storage/index.ts';
import { makeApp, waitForRun, type App } from './helpers.ts';

let app: App;
let cleanup: () => Promise<void>;

before(async () => {
  ({ app, cleanup } = await makeApp());
});
after(async () => cleanup());

describe('engine: run search', () => {
  it('paginates same-timestamp runs in the cursor key order without omissions', async () => {
    const { workflow } = await app.workflows.create({
      name: 'run pagination',
      graph: {
        nodes: [{ id: 's', type: 'start', data: {} }, { id: 'e', type: 'end', data: {} }],
        edges: [{ id: 'edge', source: 's', target: 'e' }],
      },
    });
    const source = await app.engine.createRun({ workflowId: workflow.id, input: { input_as_text: 'page me' } });
    const completed = await waitForRun(app, source.id, ['completed', 'failed']);
    await app.storage.delete(COLLECTIONS.runs, source.id);

    const createdAt = '2026-01-02T03:04:05.000Z';
    // Deliberately insert out of cursor order. Storage returns reverse insertion
    // order, while the public cursor is ordered by createdAt then ID.
    for (const id of ['run_c', 'run_a', 'run_b']) {
      await app.storage.put(COLLECTIONS.runs, id, { ...completed, id, createdAt }, workflow.id);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await app.engine.queryRuns({ workflowId: workflow.id, limit: 1, cursor });
      seen.push(...page.runs.map((run) => run.id));
      cursor = page.nextCursor;
    } while (cursor);

    assert.deepEqual(seen, ['run_c', 'run_b', 'run_a']);
  });

  it('can restrict results to the authorized owner and workspace', async () => {
    const { workflow } = await app.workflows.create({ name: 'isolated runs' });
    const base = { workflowId: workflow.id, status: 'completed', createdAt: new Date().toISOString(), input: { input_as_text: '' }, usage: { inputTokens: 0, outputTokens: 0, llmCalls: 0, toolCalls: 0, estimatedCostUsd: 0, unpricedLlmCalls: 0, byModel: {}, byEmbeddingModel: {} } };
    await app.storage.put(COLLECTIONS.runs, 'owned-run', { ...base, id: 'owned-run', ownerId: 'alice', workspaceId: 'space-a' }, workflow.id);
    await app.storage.put(COLLECTIONS.runs, 'other-run', { ...base, id: 'other-run', ownerId: 'bob', workspaceId: 'space-a' }, workflow.id);
    await app.storage.put(COLLECTIONS.runs, 'other-space', { ...base, id: 'other-space', ownerId: 'alice', workspaceId: 'space-b' }, workflow.id);
    const result = await app.engine.queryRuns({ workflowId: workflow.id, ownerId: 'alice', workspaceId: 'space-a' });
    assert.deepEqual(result.runs.map((run) => run.id), ['owned-run']);
  });
});
