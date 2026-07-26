import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/index.ts';
import type { WorkflowGraph } from '../src/domain/types.ts';
import { waitForRun } from './helpers.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-retention-'));
let app: Awaited<ReturnType<typeof createApp>>;
const graph: WorkflowGraph = {
  nodes: [{ id: 's', type: 'start', name: 'Start', config: {} }, { id: 'e', type: 'end', name: 'End', config: { output: 'done' } }],
  edges: [{ id: 'se', source: 's', target: 'e' }],
};

before(async () => {
  process.env.AGENT_BUILDER_DATA_DIR = dir;
  process.env.AGENT_BUILDER_STORAGE = 'json';
  process.env.AGENT_BUILDER_TRACE_RETENTION_MAX_RUNS = '1';
  process.env.AGENT_BUILDER_TRACE_RETENTION_MAX_AGE_DAYS = '0';
  process.env.AGENT_BUILDER_TRACE_RETENTION_INTERVAL_SECONDS = '10';
  app = await createApp();
});
after(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.AGENT_BUILDER_TRACE_RETENTION_MAX_RUNS;
  delete process.env.AGENT_BUILDER_TRACE_RETENTION_MAX_AGE_DAYS;
  delete process.env.AGENT_BUILDER_TRACE_RETENTION_INTERVAL_SECONDS;
});

async function completedRun() {
  const workflow = await app.workflows.create({ name: 'retention', graph });
  const run = await app.engine.createRun({ workflowId: workflow.workflow.id, input: {} });
  return waitForRun(app as any, run.id, ['completed']);
}

describe('automatic trace retention', () => {
  it('supports dry runs and one cross-instance-style lease winner', async () => {
    (app.engine as any).config.traceRetentionMaxRuns = 0;
    const first = await completedRun();
    const second = await completedRun();
    const dryRun = await app.engine.maybeEnforceTraceRetention(true, { dryRun: true, maxRuns: 1, maxAgeDays: 0 });
    assert.ok(Number(dryRun.candidates) >= 1);
    assert.ok(await app.engine.getRun(first.id));
    assert.ok(await app.engine.getRun(second.id));

    const [left, right] = await Promise.all([
      app.engine.maybeEnforceTraceRetention(true, { maxRuns: 1, maxAgeDays: 0 }),
      app.engine.maybeEnforceTraceRetention(true, { maxRuns: 1, maxAgeDays: 0 }),
    ]);
    assert.ok([left, right].some((result) => result.skipped === 'lease_held'));
    assert.equal((await app.engine.listRuns()).length, 1);
    (app.engine as any).config.traceRetentionMaxRuns = 1;
  });

  it('records throttled post-run status metrics', async () => {
    await completedRun();
    for (let attempt = 0; attempt < 100; attempt++) {
      const status = await app.engine.traceRetentionStatus();
      if (status.finishedAt) {
        assert.equal(status.maxRuns, 1);
        assert.equal(typeof status.scanned, 'number');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail('terminal run did not trigger retention status persistence');
  });

  it('enforces configured policy during startup', async () => {
    await completedRun();
    await completedRun();
    await app.close();
    app = await createApp();
    assert.ok((await app.engine.listRuns()).length <= 1);
  });

  it('removes malformed timestamp records when age retention is enabled', async () => {
    const run = await completedRun();
    await app.storage.put('runs' as any, run.id, { ...run, endedAt: 'not-a-date', createdAt: 'also-not-a-date' }, run.workflowId);
    const result = await app.engine.enforceTraceRetention({ maxRuns: 0, maxAgeDays: 1 });
    assert.ok(result.deleted >= 1);
    assert.equal(await app.engine.getRun(run.id), undefined);
  });
});
