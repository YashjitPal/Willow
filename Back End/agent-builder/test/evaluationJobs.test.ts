import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { EvaluationRun } from '../src/services/evaluations.ts';
import { COLLECTIONS } from '../src/storage/index.ts';
import { makeApp, waitForRun, type App } from './helpers.ts';

let app: App;
let cleanup: () => Promise<void>;

before(async () => {
  ({ app, cleanup } = await makeApp());
});

after(async () => {
  await cleanup();
});

async function fixture(count = 6) {
  const { workflow } = await app.workflows.create({
    name: 'Evaluation jobs',
    graph: {
      nodes: [
        { id: 's', type: 'start', data: {} },
        { id: 'e', type: 'end', config: { output: '{{workflow.input_as_text}}' } },
      ],
      edges: [{ id: 'se', source: 's', target: 'e' }],
    },
  });
  const runs = [];
  for (let index = 0; index < count; index++) {
    const created = await app.engine.createRun({ workflowId: workflow.id, input: { input_as_text: `case ${index}` } });
    runs.push(await waitForRun(app, created.id, ['completed', 'failed']));
  }
  const evaluation = await app.evaluations.create({
    workflowId: workflow.id,
    name: 'Durable evaluation',
    graders: [{ id: 'status', name: 'Completed', type: 'run_status', expected: 'completed' }],
  });
  return { evaluation, runs };
}

async function waitForEvaluationRun(id: string, statuses: EvaluationRun['status'][], timeoutMs = 5000) {
  const started = Date.now();
  for (;;) {
    const run = await app.evaluations.getRun(id);
    if (run && statuses.includes(run.status)) return run;
    if (Date.now() - started > timeoutMs) throw new Error(`evaluation run ${id} did not reach ${statuses.join(', ')}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('durable evaluation jobs', () => {
  it('persists human ratings and feedback on individual evaluation results', async () => {
    const { evaluation, runs } = await fixture(1);
    const job = await app.evaluations.evaluate(evaluation.id, [runs[0].id]);
    await waitForEvaluationRun(job.id, ['completed']);

    const annotated = await app.evaluations.annotateResult(job.id, runs[0].id, {
      rating: 'negative',
      feedback: 'The answer missed the requested constraint.',
    });

    assert.equal(annotated?.results[0].annotation?.rating, 'negative');
    assert.equal(annotated?.results[0].annotation?.feedback, 'The answer missed the requested constraint.');
    assert.equal((await app.evaluations.getRun(job.id))?.results[0].annotation?.reviewerId, 'default');
    await assert.rejects(
      app.evaluations.annotateResult(job.id, 'missing-run', { rating: 'positive' }),
      /evaluation result for run 'missing-run' not found/,
    );
  });

  it('selects trace eval runs by model, tool call, and date range', async () => {
    const { evaluation, runs } = await fixture(3);
    const matching = runs[1];
    matching.usage.byModel = {
      'mock:filter-model': {
        provider: 'mock', model: 'filter-model', inputTokens: 1, outputTokens: 1,
        cachedInputTokens: 0, cacheWriteInputTokens: 0, reasoningTokens: 0, llmCalls: 1,
        pricing: { status: 'unpriced', catalogVersion: matching.usage.pricingCatalogVersion, currency: 'USD' },
      },
    };
    await app.storage.put(COLLECTIONS.runs, matching.id, matching, matching.workflowId);
    await app.storage.put(COLLECTIONS.spans, `${matching.id}:filter-tool`, {
      seq: 999,
      event: { type: 'tool.completed', runId: matching.id, nodeId: 'tool-node', tool: 'calendar_lookup', callId: 'call_filter', result: {}, attempts: 1, at: matching.createdAt },
    }, matching.id);

    const job = await app.evaluations.evaluate(evaluation.id, undefined, undefined, undefined, {
      model: 'filter-model',
      tool: 'calendar_lookup',
      from: new Date(Date.parse(matching.createdAt) - 1_000).toISOString(),
      to: new Date(Date.parse(matching.createdAt) + 1_000).toISOString(),
    });
    assert.deepEqual(job.runIds, [matching.id]);
    assert.equal(job.selection?.tool, 'calendar_lookup');
    const completed = await waitForEvaluationRun(job.id, ['completed']);
    assert.deepEqual(completed.runIds, [matching.id]);
  });

  it('rejects empty filtered selections and filters combined with explicit ids', async () => {
    const { evaluation, runs } = await fixture(1);
    await assert.rejects(
      app.evaluations.evaluate(evaluation.id, undefined, undefined, undefined, { model: 'does-not-exist' }),
      /no workflow runs matched/,
    );
    await assert.rejects(
      app.evaluations.evaluate(evaluation.id, [runs[0].id], undefined, undefined, { tool: 'calendar_lookup' }),
      /cannot be combined/,
    );
  });

  it('persists progress and supports cancellation between run boundaries', async () => {
    const { evaluation, runs } = await fixture();
    const service = app.evaluations as any;
    const originalGrade = service.grade.bind(service);
    service.grade = async (...args: unknown[]) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return originalGrade(...args);
    };
    try {
      const job = await app.evaluations.evaluate(evaluation.id, runs.map((run) => run.id));
      assert.ok(['queued', 'running'].includes(job.status));
      assert.equal(job.totalRuns, runs.length);
      const cancelled = await app.evaluations.cancelRun(job.id);
      assert.equal(cancelled?.status, 'cancelled');
      const result = await waitForEvaluationRun(job.id, ['cancelled']);
      assert.equal(result.status, 'cancelled');
      assert.ok(result.completedRuns < result.totalRuns);
    } finally {
      service.grade = originalGrade;
    }
  });

  it('never lets a concurrent progress save revive a cancelled job', async () => {
    const { evaluation, runs } = await fixture(1);
    const storage = app.storage as any;
    const originalCompareAndSwap = storage.compareAndSwap.bind(storage);
    let releaseProgress!: () => void;
    const progressBlocked = new Promise<void>((resolve) => { releaseProgress = resolve; });
    let progressReached!: () => void;
    const reachedProgress = new Promise<void>((resolve) => { progressReached = resolve; });
    let intercepted = false;
    storage.compareAndSwap = async (...args: unknown[]) => {
      const [collection, , field, expected, doc] = args as [string, string, string, unknown, EvaluationRun];
      if (!intercepted && collection === COLLECTIONS.evaluationRuns && field === 'status'
        && expected === 'running' && doc.completedRuns === 1) {
        intercepted = true;
        progressReached();
        await progressBlocked;
      }
      return originalCompareAndSwap(...args);
    };
    try {
      const job = await app.evaluations.evaluate(evaluation.id, [runs[0].id]);
      await reachedProgress;
      const cancelled = await app.evaluations.cancelRun(job.id);
      assert.equal(cancelled?.status, 'cancelled');
      releaseProgress();
      const settled = await waitForEvaluationRun(job.id, ['cancelled']);
      assert.equal(settled.status, 'cancelled');
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal((await app.evaluations.getRun(job.id))?.status, 'cancelled');
      assert.equal(await app.evaluations.recoverPendingRuns(), 0);
    } finally {
      releaseProgress?.();
      storage.compareAndSwap = originalCompareAndSwap;
    }
  });

  it('releases trace retention pins when an evaluation is deleted', async () => {
    const { evaluation, runs } = await fixture(3);
    const latest = await app.engine.createRun({ workflowId: runs[0].workflowId, input: { input_as_text: 'newer run' } });
    await waitForRun(app, latest.id, ['completed', 'failed']);
    const pinnedRun = runs[0];
    const job = await app.evaluations.evaluate(evaluation.id, [pinnedRun.id]);
    await waitForEvaluationRun(job.id, ['completed']);

    const whilePinned = await app.engine.enforceTraceRetention({ maxRuns: 1 });
    assert.ok(whilePinned.protected >= 1);
    assert.ok(await app.engine.getRun(pinnedRun.id));

    assert.equal(await app.evaluations.remove(evaluation.id), true);
    const afterDelete = await app.engine.enforceTraceRetention({ maxRuns: 1 });
    assert.ok(afterDelete.deleted >= 1);
    assert.equal(await app.engine.getRun(pinnedRun.id), undefined);
  });

  it('keeps runs selected by an active evaluation protected during retention', async () => {
    const { evaluation, runs } = await fixture(2);
    const service = app.evaluations as any;
    const originalGrade = service.grade.bind(service);
    service.grade = async (...args: unknown[]) => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return originalGrade(...args);
    };
    try {
      const job = await app.evaluations.evaluate(evaluation.id, runs.map((run) => run.id));
      await waitForEvaluationRun(job.id, ['running']);
      const retained = await app.engine.enforceTraceRetention({ maxRuns: 1 });
      assert.ok(retained.protected >= runs.length);
      for (const run of runs) assert.ok(await app.engine.getRun(run.id));
      await app.evaluations.cancelRun(job.id);
      await waitForEvaluationRun(job.id, ['cancelled']);
    } finally {
      service.grade = originalGrade;
    }
  });

  it('resumes a persisted job without repeating completed run boundaries', async () => {
    const { evaluation, runs } = await fixture(2);
    const created = await app.evaluations.evaluate(evaluation.id, runs.map((run) => run.id));
    const baseline = await waitForEvaluationRun(created.id, ['completed']);
    assert.equal(baseline.status, 'completed');
    const resumable: EvaluationRun = {
      ...structuredClone(baseline),
      id: 'evalrun_resume_boundary',
      status: 'running',
      results: [structuredClone(baseline.results[0])],
      completedRuns: 1,
      score: baseline.results[0].score,
      usage: structuredClone(baseline.results[0].usage),
      completedAt: undefined,
      updatedAt: new Date().toISOString(),
    };
    await app.storage.put(COLLECTIONS.evaluationRuns, resumable.id, resumable, evaluation.id);

    const service = app.evaluations as any;
    const originalGrade = service.grade.bind(service);
    let gradeCalls = 0;
    service.grade = async (...args: unknown[]) => {
      gradeCalls++;
      return originalGrade(...args);
    };
    try {
      assert.equal(await app.evaluations.recoverPendingRuns(), 1);
      const recovered = await waitForEvaluationRun(resumable.id, ['completed']);
      assert.equal(recovered.completedRuns, 2);
      assert.deepEqual(recovered.runIds, runs.map((run) => run.id));
      assert.equal(gradeCalls, 1);
    } finally {
      service.grade = originalGrade;
    }
  });

  it('recovers with the immutable grader snapshot after the definition changes', async () => {
    const { evaluation, runs } = await fixture(1);
    const created = await app.evaluations.evaluate(evaluation.id, [runs[0].id]);
    const baseline = await waitForEvaluationRun(created.id, ['completed']);
    assert.equal(baseline.score, 1);
    assert.deepEqual(baseline.definitionSnapshot?.graders, evaluation.graders);

    await app.evaluations.update(evaluation.id, {
      graders: [{ id: 'changed', name: 'Changed', type: 'run_status', expected: 'failed' }],
    });
    const resumable: EvaluationRun = {
      ...structuredClone(baseline),
      id: 'evalrun_definition_snapshot',
      status: 'running',
      results: [],
      completedRuns: 0,
      score: 0,
      usage: {
        inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0,
        reasoningTokens: 0, modelCalls: 0, estimatedCostUsd: 0, unpricedLlmCalls: 0,
        unpricedModelCalls: 0, pricingCatalogVersion: baseline.usage.pricingCatalogVersion, byModel: {},
      },
      completedAt: undefined,
      updatedAt: new Date().toISOString(),
    };
    await app.storage.put(COLLECTIONS.evaluationRuns, resumable.id, resumable, evaluation.id);

    assert.equal(await app.evaluations.recoverPendingRuns(), 1);
    const recovered = await waitForEvaluationRun(resumable.id, ['completed']);
    assert.equal(recovered.score, 1);
    assert.equal(recovered.results[0].results[0].graderId, 'status');
  });

  it('pauses model-judge jobs for credentials and resumes without persisting keys', async () => {
    const { evaluation, runs } = await fixture(1);
    await app.evaluations.update(evaluation.id, {
      graders: [{ id: 'judge', name: 'Judge', type: 'model_judge', model: 'gpt-4.1-mini', rubric: 'score the output' }],
    });
    const job = await app.evaluations.evaluate(evaluation.id, [runs[0].id]);
    const paused = await waitForEvaluationRun(job.id, ['awaiting_credentials']);
    assert.deepEqual(paused.credentialRequirements?.providers, ['openai']);
    const persisted = await app.storage.get<Record<string, unknown>>(COLLECTIONS.evaluationRuns, job.id);
    assert.equal(JSON.stringify(persisted).includes('sk-evaluation-only'), false);
    assert.equal(await app.evaluations.recoverPendingRuns(), 0);

    const service = app.evaluations as any;
    const originalGrade = service.grade.bind(service);
    service.grade = async () => ({
      graderId: 'judge', name: 'Judge', passed: true, score: 1, detail: 'stubbed judge',
    });
    try {
      const resumed = await app.evaluations.resumeRun(job.id, { openai: ['sk-evaluation-only'] });
      assert.equal(resumed?.status, 'queued');
      const completed = await waitForEvaluationRun(job.id, ['completed']);
      assert.equal(completed.score, 1);
      assert.equal(JSON.stringify(await app.storage.get(COLLECTIONS.evaluationRuns, job.id)).includes('sk-evaluation-only'), false);
    } finally {
      service.grade = originalGrade;
    }
  });

  it('does not revive a cancelled job when credential resume races cancellation', async () => {
    const { evaluation, runs } = await fixture(1);
    await app.evaluations.update(evaluation.id, {
      graders: [{ id: 'judge', name: 'Judge', type: 'model_judge', model: 'gpt-4.1-mini', rubric: 'score the output' }],
    });
    const job = await app.evaluations.evaluate(evaluation.id, [runs[0].id]);
    await waitForEvaluationRun(job.id, ['awaiting_credentials']);

    const storage = app.storage as any;
    const originalCompareAndSwap = storage.compareAndSwap.bind(storage);
    let resumeReached!: () => void;
    const reachedResume = new Promise<void>((resolve) => { resumeReached = resolve; });
    let releaseResume!: () => void;
    const resumeBlocked = new Promise<void>((resolve) => { releaseResume = resolve; });
    storage.compareAndSwap = async (...args: unknown[]) => {
      const [collection, id, field, expected, doc] = args as [string, string, string, unknown, EvaluationRun];
      if (collection === COLLECTIONS.evaluationRuns && id === job.id && field === 'status'
        && expected === 'awaiting_credentials' && doc.status === 'queued') {
        resumeReached();
        await resumeBlocked;
      }
      return originalCompareAndSwap(...args);
    };
    try {
      const resuming = app.evaluations.resumeRun(job.id, { openai: ['sk-race-only'] });
      await reachedResume;
      assert.equal((await app.evaluations.cancelRun(job.id))?.status, 'cancelled');
      releaseResume();
      await assert.rejects(resuming, /changed while resuming \(status: cancelled\)/);
      assert.equal((await app.evaluations.getRun(job.id))?.status, 'cancelled');
    } finally {
      releaseResume?.();
      storage.compareAndSwap = originalCompareAndSwap;
    }
  });

  it('pauses generated cases when provider credentials are unavailable', async () => {
    const { workflow } = await app.workflows.create({
      name: 'Credential child run',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'a', type: 'agent', config: { instructions: 'Answer briefly.', model: 'gpt-4.1-mini' } },
          { id: 'e', type: 'end', config: { output: '{{a.output_text}}' } },
        ],
        edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
      },
    });
    const evaluation = await app.evaluations.create({
      workflowId: workflow.id,
      name: 'Credential child evaluation',
      graders: [{ id: 'status', name: 'Status', type: 'run_status', expected: 'completed' }],
      testCases: [{ id: 'case', name: 'Case', input: { input_as_text: 'hello' }, version: 0 }],
    });
    const job = await app.evaluations.evaluate(evaluation.id);
    const paused = await waitForEvaluationRun(job.id, ['awaiting_credentials']);
    assert.deepEqual(paused.credentialRequirements?.providers, ['openai']);
    assert.equal(paused.caseRuns?.[0]?.runId, undefined);
    assert.equal(JSON.stringify(await app.evaluations.getRun(job.id)).includes('sk-child-only'), false);
  });

  it('cancels and drains active jobs before deleting an evaluation', async () => {
    const { evaluation, runs } = await fixture(2);
    const service = app.evaluations as any;
    const originalGrade = service.grade.bind(service);
    service.grade = async (...args: unknown[]) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return originalGrade(...args);
    };
    try {
      const job = await app.evaluations.evaluate(evaluation.id, runs.map((run) => run.id));
      await waitForEvaluationRun(job.id, ['running']);
      assert.equal(await app.evaluations.remove(evaluation.id), true);
      assert.equal(await app.evaluations.get(evaluation.id), undefined);
      assert.equal(await app.evaluations.getRun(job.id), undefined);
      await new Promise((resolve) => setTimeout(resolve, 220));
      assert.equal(await app.evaluations.getRun(job.id), undefined);
    } finally {
      service.grade = originalGrade;
    }
  });

  it('recovers generated case runs from their persisted mapping', async () => {
    const { workflow } = await app.workflows.create({
      name: 'Case recovery',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'e', type: 'end', config: { output: '{{workflow.input_as_text}}' } },
        ],
        edges: [{ id: 'se', source: 's', target: 'e' }],
      },
    });
    const evaluation = await app.evaluations.create({
      workflowId: workflow.id,
      name: 'Generated case recovery',
      graders: [{ id: 'status', name: 'Completed', type: 'run_status', expected: 'completed' }],
      testCases: [{ id: 'case-a', name: 'Case A', input: { input_as_text: 'recover me' }, version: 0 }],
    });
    const created = await app.evaluations.evaluate(evaluation.id);
    const baseline = await waitForEvaluationRun(created.id, ['completed']);
    assert.equal(baseline.caseRuns?.length, 1);
    assert.ok(baseline.caseRuns?.[0].runId);

    const resumable: EvaluationRun = {
      ...structuredClone(baseline),
      id: 'evalrun_case_resume',
      status: 'running',
      results: [],
      runIds: [],
      completedRuns: 0,
      score: 0,
      usage: {
        inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0,
        reasoningTokens: 0, modelCalls: 0, estimatedCostUsd: 0, unpricedLlmCalls: 0,
        unpricedModelCalls: 0, pricingCatalogVersion: baseline.usage.pricingCatalogVersion, byModel: {},
      },
      completedAt: undefined,
      updatedAt: new Date().toISOString(),
    };
    await app.storage.put(COLLECTIONS.evaluationRuns, resumable.id, resumable, evaluation.id);
    assert.equal(await app.evaluations.recoverPendingRuns(), 1);
    const recovered = await waitForEvaluationRun(resumable.id, ['completed']);
    assert.equal(recovered.runIds.length, 1);
    assert.equal(recovered.runIds[0], baseline.runIds[0]);
    assert.equal(recovered.completedRuns, 1);
  });

  it('executes version-zero cases against the draft captured at enqueue time', async () => {
    const { workflow } = await app.workflows.create({
      name: 'Draft snapshot evaluation',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'e', type: 'end', config: { output: 'captured draft' } },
        ],
        edges: [{ id: 'se', source: 's', target: 'e' }],
      },
    });
    const evaluation = await app.evaluations.create({
      workflowId: workflow.id,
      name: 'Draft snapshot',
      graders: [{ id: 'captured', name: 'Captured', type: 'contains', expected: 'captured draft' }],
      testCases: [{ id: 'case-draft', name: 'Draft case', input: { input_as_text: 'run' }, version: 0 }],
    });
    const service = app.evaluations as any;
    const originalLaunch = service.launchJob.bind(service);
    service.launchJob = () => {};
    const queued = await app.evaluations.evaluate(evaluation.id);
    await new Promise((resolve) => setTimeout(resolve, 10));
    service.launchJob = originalLaunch;

    const current = await app.workflows.get(workflow.id);
    assert.ok(current);
    await app.workflows.saveDraft(workflow.id, {
      nodes: [
        { id: 's', type: 'start', data: {} },
        { id: 'e', type: 'end', config: { output: 'mutated draft' } },
      ],
      edges: [{ id: 'se', source: 's', target: 'e' }],
    }, current!.draftRevision);

    assert.equal(await app.evaluations.recoverPendingRuns(), 1);
    const recovered = await waitForEvaluationRun(queued.id, ['completed']);
    assert.match(recovered.draftSnapshot?.sha256 ?? '', /^[a-f0-9]{64}$/);
    assert.equal(recovered.results[0].score, 1);
    const child = await app.engine.getRun(recovered.runIds[0]);
    assert.equal(child?.output, 'captured draft');
  });

  it('cancels an active generated case run with its evaluation job', async () => {
    const { workflow } = await app.workflows.create({
      name: 'Case cancellation',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'a', type: 'agent', data: { label: 'Slow', model: 'mock/delay:1000', instructions: 'Wait.' } },
          { id: 'e', type: 'end', config: { output: '{{slow.output_text}}' } },
        ],
        edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
      },
    });
    const evaluation = await app.evaluations.create({
      workflowId: workflow.id,
      name: 'Generated case cancellation',
      graders: [{ id: 'status', name: 'Completed', type: 'run_status', expected: 'completed' }],
      testCases: [{ id: 'slow-case', name: 'Slow case', input: { input_as_text: 'cancel me' }, version: 0 }],
    });
    const created = await app.evaluations.evaluate(evaluation.id);
    let childRunId: string | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      childRunId = (await app.evaluations.getRun(created.id))?.caseRuns?.[0].runId;
      if (childRunId) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(childRunId);
    assert.equal((await app.evaluations.cancelRun(created.id))?.status, 'cancelled');
    const cancelled = await waitForEvaluationRun(created.id, ['cancelled']);
    assert.equal(cancelled.status, 'cancelled');
    const child = await waitForRun(app, childRunId!, ['cancelled', 'completed', 'failed']);
    assert.equal(child.status, 'cancelled');
  });
});
