import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BatchJob } from '../src/domain/types.ts';
import { COLLECTIONS } from '../src/storage/index.ts';
import { nowIso } from '../src/util/id.ts';
import { listen, makeApp, type App } from './helpers.ts';

async function publishedWorkflow(app: App, model = 'mock/delay:80') {
  const { workflow } = await app.workflows.create({
    name: 'Batch workflow',
    graph: {
      nodes: [
        { id: 's', type: 'start', config: {} },
        { id: 'a', type: 'agent', name: 'Agent', config: { model, instructions: '', tools: [], outputFormat: 'text' } },
        { id: 'e', type: 'end', config: { output: '{{agent.output_text}}' } },
      ],
      edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
    },
  });
  await app.workflows.publish(workflow.id);
  return workflow.id;
}

async function waitBatch(app: App, id: string, statuses: string[], timeoutMs = 10_000): Promise<BatchJob> {
  const started = Date.now();
  for (;;) {
    const batch = await app.batches.get(id);
    if (batch && statuses.includes(batch.status)) return batch;
    if (Date.now() - started > timeoutMs) throw new Error(`batch ${id} did not reach ${statuses.join(',')} (status: ${batch?.status})`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('durable batch runs', () => {
  it('enforces workflow ownership on direct batch reads and controls', async () => {
    const { app, cleanup } = await makeApp();
    const server = await listen(app);
    const request = async (method: string, path: string, body?: unknown, token?: string) => {
      const response = await fetch(`${server.baseUrl}${path}`, {
        method,
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, data: text ? JSON.parse(text) : undefined };
    };
    try {
      const admin = await request('POST', '/api/v1/admin/api-keys', { name: 'batch admin', role: 'admin' });
      const owner = await request('POST', '/api/v1/admin/api-keys', { name: 'batch owner', role: 'publisher', subjectId: 'batch-owner', workspaceId: 'batch-space' }, admin.data.token);
      const intruder = await request('POST', '/api/v1/admin/api-keys', { name: 'batch intruder', role: 'publisher', subjectId: 'batch-intruder', workspaceId: 'batch-space' }, admin.data.token);
      const reader = await request('POST', '/api/v1/admin/api-keys', { name: 'batch reader', role: 'viewer', scopes: ['run:read'], subjectId: 'batch-reader', workspaceId: 'batch-space' }, admin.data.token);
      const workflow = await request('POST', '/api/v1/workflows', {
        name: 'Owned batch workflow',
        graph: {
          nodes: [
            { id: 's', type: 'start', config: {} },
            { id: 'a', type: 'agent', name: 'Agent', config: { model: 'mock/delay:1000', instructions: '', tools: [], outputFormat: 'text' } },
            { id: 'e', type: 'end', config: { output: '{{agent.output_text}}' } },
          ],
          edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
        },
      }, owner.data.token);
      assert.equal((await request('POST', `/api/v1/workflows/${workflow.data.workflow.id}/publish`, {}, owner.data.token)).status, 200);
      const submitted = await request('POST', `/api/v1/workflows/${workflow.data.workflow.id}/batches`, { version: 1, concurrency: 1, inputs: ['one', 'two'] }, owner.data.token);
      assert.equal(submitted.status, 200);
      const batchId = submitted.data.batch.id;
      assert.equal((await request('GET', `/api/v1/batches/${batchId}`, undefined, owner.data.token)).status, 200);
      assert.equal((await request('GET', `/api/v1/batches/${batchId}`, undefined, intruder.data.token)).status, 404);
      assert.equal((await request('POST', `/api/v1/batches/${batchId}/cancel`, {}, intruder.data.token)).status, 404);
      assert.equal((await request('POST', `/api/v1/batches/${batchId}/resume`, {}, intruder.data.token)).status, 404);
      assert.equal((await request('POST', `/api/v1/batches/${batchId}/cancel`, {}, reader.data.token)).status, 403);
      assert.equal((await request('GET', `/api/v1/batches/${batchId}`, undefined, admin.data.token)).status, 200);
      assert.equal((await request('POST', `/api/v1/batches/${batchId}/cancel`, {}, admin.data.token)).status, 200);
    } finally {
      await server.close();
      await cleanup();
    }
  });

  it('submits a pinned bounded-concurrency batch and deduplicates the API request', async () => {
    const { app, cleanup } = await makeApp();
    const server = await listen(app);
    try {
      const workflowId = await publishedWorkflow(app);
      const request = async () => {
        const response = await fetch(`${server.baseUrl}/api/v1/workflows/${workflowId}/batches`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': 'batch-idempotency' },
          body: JSON.stringify({ version: 1, concurrency: 2, inputs: ['one', 'two', 'three', 'four'] }),
        });
        const text = await response.text();
        assert.equal(response.status, 200, text);
        return JSON.parse(text) as { batch: BatchJob };
      };
      const first = await request();
      const second = await request();
      assert.equal(second.batch.id, first.batch.id);
      const done = await waitBatch(app, first.batch.id, ['completed']);
      assert.equal(done.workflowVersion, 1);
      assert.equal(done.concurrency, 2);
      assert.equal(done.total, 4);
      assert.equal(done.completed, 4);
      assert.equal(done.failed, 0);
      assert.ok(done.items.every((item) => item.runId && item.status === 'completed'));
      const outputs = await Promise.all(done.items.map(async (item) => (await app.engine.getRun(item.runId!))?.output));
      assert.deepEqual(outputs, ['one', 'two', 'three', 'four']);
    } finally {
      await server.close();
      await cleanup();
    }
  });

  it('cancels active and not-yet-started batch items', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const workflowId = await publishedWorkflow(app, 'mock/delay:1000');
      const batch = await app.batches.submit({ workflowId, version: 1, concurrency: 1, inputs: [{ input_as_text: 'a' }, { input_as_text: 'b' }, { input_as_text: 'c' }] });
      for (let attempt = 0; attempt < 100; attempt++) {
        const current = await app.batches.get(batch.id);
        if (current?.items.some((item) => item.runId)) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await app.batches.cancel(batch.id);
      const cancelled = await waitBatch(app, batch.id, ['cancelled']);
      assert.equal(cancelled.cancelled, 3);
      assert.ok(cancelled.items.every((item) => item.status === 'cancelled'));
    } finally {
      await cleanup();
    }
  });

  it('recovers a persisted queued job without duplicating child runs', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const workflowId = await publishedWorkflow(app, 'mock/echo');
      const now = nowIso();
      const persisted: BatchJob = {
        id: 'batch_recovery', workflowId, workflowVersion: 1, concurrency: 2,
        status: 'queued', total: 2, completed: 0, failed: 0, cancelled: 0,
        items: [
          { index: 0, input: { input_as_text: 'first' }, status: 'pending' },
          { index: 1, input: { input_as_text: 'second' }, status: 'pending' },
        ],
        createdAt: now, updatedAt: now,
      };
      await app.storage.put(COLLECTIONS.batches, persisted.id, persisted, workflowId);
      assert.equal(await app.batches.recoverPending(), 1);
      const done = await waitBatch(app, persisted.id, ['completed']);
      assert.equal(done.completed, 2);
      assert.equal(new Set(done.items.map((item) => item.runId)).size, 2);
      assert.equal(await app.batches.recoverPending(), 0);
    } finally {
      await cleanup();
    }
  });

  it('recovers an approval-paused batch after its child was resolved before restart', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const { workflow } = await app.workflows.create({
        name: 'Recover approval batch',
        graph: {
          nodes: [
            { id: 's', type: 'start', config: {} },
            { id: 'approval', type: 'userApproval', config: { message: 'Continue?' } },
            { id: 'e', type: 'end', config: { output: 'approved' } },
          ],
          edges: [
            { id: 'sa', source: 's', target: 'approval' },
            { id: 'ae', source: 'approval', target: 'e', sourceHandle: 'approved' },
            { id: 're', source: 'approval', target: 'e', sourceHandle: 'rejected' },
          ],
        },
      });
      await app.workflows.publish(workflow.id);
      const submitted = await app.batches.submit({ workflowId: workflow.id, version: 1, inputs: [{ input_as_text: 'one' }] });
      const paused = await waitBatch(app, submitted.id, ['awaiting_approval']);
      const childId = paused.items[0].runId!;
      const child = await app.engine.getRun(childId);
      assert.equal(child?.status, 'awaiting_approval');

      await app.engine.resolveApproval(childId, child!.pendingApproval!.id, { approved: true });
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((await app.engine.getRun(childId))?.status === 'completed') break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal((await app.batches.get(submitted.id))?.status, 'awaiting_approval');

      assert.equal(await app.batches.recoverPending(), 1);
      const completed = await waitBatch(app, submitted.id, ['completed']);
      assert.equal(completed.items[0].runId, childId);
      assert.equal(completed.completed, 1);
    } finally {
      await cleanup();
    }
  });

  it('continues an approval-paused batch when its child is resolved through the API', async () => {
    const { app, cleanup } = await makeApp();
    const server = await listen(app);
    try {
      const { workflow } = await app.workflows.create({
        name: 'Live approval batch',
        graph: {
          nodes: [
            { id: 's', type: 'start', config: {} },
            { id: 'approval', type: 'userApproval', config: { message: 'Continue?' } },
            { id: 'e', type: 'end', config: { output: 'approved' } },
          ],
          edges: [
            { id: 'sa', source: 's', target: 'approval' },
            { id: 'ae', source: 'approval', target: 'e', sourceHandle: 'approved' },
            { id: 're', source: 'approval', target: 'e', sourceHandle: 'rejected' },
          ],
        },
      });
      await app.workflows.publish(workflow.id);
      const submitted = await app.batches.submit({ workflowId: workflow.id, version: 1, inputs: [{ input_as_text: 'one' }] });
      const paused = await waitBatch(app, submitted.id, ['awaiting_approval']);
      const child = await app.engine.getRun(paused.items[0].runId!);
      const response = await fetch(`${server.baseUrl}/api/v1/runs/${child!.id}/approvals/${child!.pendingApproval!.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      });
      assert.equal(response.status, 200, await response.text());
      const completed = await waitBatch(app, submitted.id, ['completed']);
      assert.equal(completed.completed, 1);
      assert.equal(completed.items[0].runId, child!.id);
    } finally {
      await server.close();
      await cleanup();
    }
  });

  it('represents credential pauses without persisting request keys', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const workflowId = await publishedWorkflow(app, 'gpt-5');
      const batch = await app.batches.submit({ workflowId, version: 1, inputs: [{ input_as_text: 'needs a key' }] });
      const paused = await waitBatch(app, batch.id, ['awaiting_credentials']);
      assert.deepEqual(paused.items[0].credentialRequirements, { providers: ['openai'] });
      await assert.rejects(() => app.batches.resume(batch.id), /credentials required/);
      const stored = await app.storage.get<BatchJob>(COLLECTIONS.batches, batch.id);
      assert.doesNotMatch(JSON.stringify(stored), /requestKeys|providerKeys|x-provider-keys/i);
    } finally {
      await cleanup();
    }
  });

  it('does not revive a credential-paused batch when cancellation wins a resume race', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const workflowId = await publishedWorkflow(app, 'gpt-5');
      const submitted = await app.batches.submit({ workflowId, version: 1, inputs: [{ input_as_text: 'needs a key' }] });
      const paused = await waitBatch(app, submitted.id, ['awaiting_credentials']);
      const childId = paused.items[0].runId!;
      const originalResume = app.engine.resumeRun.bind(app.engine);
      let releaseResume!: () => void;
      const resumeBlocked = new Promise<void>((resolve) => { releaseResume = resolve; });
      let resumeEntered!: () => void;
      const resumeStarted = new Promise<void>((resolve) => { resumeEntered = resolve; });
      app.engine.resumeRun = async (...args) => {
        resumeEntered();
        await resumeBlocked;
        return originalResume(...args);
      };

      const resume = app.batches.resume(submitted.id, { openai: ['test-key'] });
      await resumeStarted;
      await app.batches.cancel(submitted.id);
      releaseResume();
      await assert.rejects(resume, /not awaiting credentials \(status: cancelled\)/);

      const cancelled = await waitBatch(app, submitted.id, ['cancelled']);
      assert.equal(cancelled.cancelRequested, true);
      assert.equal(cancelled.items[0].status, 'cancelled');
      assert.equal((await app.engine.getRun(childId))?.status, 'cancelled');
    } finally {
      await cleanup();
    }
  });

  it('blocks workflow deletion while a batch is active and cleans terminal batch metadata', async () => {
    const { app, cleanup } = await makeApp();
    const server = await listen(app);
    try {
      const workflowId = await publishedWorkflow(app, 'mock/delay:500');
      const batch = await app.batches.submit({ workflowId, version: 1, concurrency: 1, inputs: [{ input_as_text: 'delete me' }] });
      const response = await fetch(`${server.baseUrl}/api/v1/workflows/${workflowId}`, { method: 'DELETE' });
      const body = await response.json() as { error: { code: string; details?: { batchIds?: string[] } } };
      assert.equal(response.status, 409);
      assert.equal(body.error.code, 'workflow_in_use');
      assert.deepEqual(body.error.details?.batchIds, [batch.id]);
      await app.batches.cancel(batch.id);
      await waitBatch(app, batch.id, ['cancelled']);
      const deleted = await fetch(`${server.baseUrl}/api/v1/workflows/${workflowId}`, { method: 'DELETE' });
      assert.equal(deleted.status, 200);
      assert.equal(await app.storage.get(COLLECTIONS.batches, batch.id), undefined);
    } finally {
      await server.close();
      await cleanup();
    }
  });

  it('pins every batch child run against trace retention', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const workflowId = await publishedWorkflow(app, 'mock/echo');
      const batch = await app.batches.submit({ workflowId, version: 1, inputs: [{ input_as_text: 'retain me' }] });
      const completed = await waitBatch(app, batch.id, ['completed']);
      const batchRunId = completed.items[0].runId!;
      const newer = await app.engine.createRun({ workflowId, version: 1, input: { input_as_text: 'evict me' } });
      for (let attempt = 0; attempt < 100; attempt++) {
        const current = await app.engine.getRun(newer.id);
        if (current?.status === 'completed') break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const result = await app.engine.enforceTraceRetention({ maxRuns: 1 });
      assert.ok(result.protected >= 1);
      assert.ok(await app.engine.getRun(batchRunId));
    } finally {
      await cleanup();
    }
  });
});
