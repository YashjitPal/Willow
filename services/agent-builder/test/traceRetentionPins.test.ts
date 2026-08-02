import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChatThread, WorkflowGraph } from '../src/domain/types.ts';
import { COLLECTIONS } from '../src/storage/index.ts';
import { makeApp, waitForRun } from './helpers.ts';

const graph: WorkflowGraph = {
  nodes: [
    { id: 'start', type: 'start', name: 'Start', config: {} },
    { id: 'end', type: 'end', name: 'End', config: { output: 'done' } },
  ],
  edges: [{ id: 'start-end', source: 'start', target: 'end' }],
};

describe('trace retention references', () => {
  it('keeps traces referenced by persisted chat threads', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const workflow = await app.workflows.create({ name: 'chat retention', graph });
      const createCompletedRun = async () => {
        const run = await app.engine.createRun({ workflowId: workflow.workflow.id, input: {} });
        return waitForRun(app, run.id, ['completed']);
      };

      const chatRun = await createCompletedRun();
      const evictableRun = await createCompletedRun();
      const newestRun = await createCompletedRun();
      const now = new Date().toISOString();
      const thread: ChatThread = {
        id: 'th_retention_test',
        sessionId: 'cks_retention_test',
        workflowId: workflow.workflow.id,
        messages: [
          { id: 'msg_user', role: 'user', content: 'hello', runId: chatRun.id, at: now },
          { id: 'msg_assistant', role: 'assistant', content: 'done', runId: chatRun.id, status: 'completed', at: now },
        ],
        createdAt: now,
        updatedAt: now,
      };
      await app.storage.put(COLLECTIONS.threads, thread.id, thread, thread.sessionId);

      const result = await app.engine.enforceTraceRetention({ maxRuns: 1 });

      assert.ok(result.protected >= 1);
      assert.ok(await app.engine.getRun(chatRun.id));
      assert.equal(await app.engine.getRun(evictableRun.id), undefined);
      assert.ok(await app.engine.getRun(newestRun.id));
    } finally {
      await cleanup();
    }
  });

  it('keeps the complete nested subflow lineage when the parent is pinned', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const workflow = await app.workflows.create({ name: 'nested retention', graph });
      const now = new Date().toISOString();
      const usage = { inputTokens: 0, outputTokens: 0, llmCalls: 0, toolCalls: 0, estimatedCostUsd: 0, unpricedLlmCalls: 0, byModel: {}, byEmbeddingModel: {} };
      const parent = { id: 'run_parent_retention', workflowId: workflow.workflow.id, status: 'completed', createdAt: now, endedAt: now, childRunIds: ['run_child_retention'], usage };
      const child = { id: 'run_child_retention', workflowId: workflow.workflow.id, status: 'completed', createdAt: now, endedAt: now, parentRunId: parent.id, parentNodeId: 'call', usage };
      await app.storage.put(COLLECTIONS.runs, parent.id, parent, workflow.workflow.id);
      await app.storage.put(COLLECTIONS.runs, child.id, child, workflow.workflow.id);
      await app.storage.put(COLLECTIONS.threads, 'th_nested_retention', {
        id: 'th_nested_retention', sessionId: 's_nested_retention', workflowId: workflow.workflow.id,
        messages: [{ id: 'm', role: 'assistant', content: 'done', runId: parent.id, status: 'completed', at: now }], createdAt: now, updatedAt: now,
      } satisfies ChatThread, 's_nested_retention');

      const result = await app.engine.enforceTraceRetention({ maxRuns: 0 });
      assert.ok(result.protected >= 2);
      assert.ok(await app.engine.getRun(parent.id));
      assert.ok(await app.engine.getRun(child.id));
    } finally {
      await cleanup();
    }
  });
});
