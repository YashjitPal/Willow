import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { listen, makeApp, type App } from './helpers.ts';
import { COLLECTIONS } from '../src/storage/index.ts';
import type { EvaluationRun } from '../src/services/evaluations.ts';

let app: App;
let cleanup: () => Promise<void>;
let closeServer: () => Promise<void>;
let baseUrl = '';

async function api(method: string, path: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : undefined };
}

before(async () => {
  ({ app, cleanup } = await makeApp());
  ({ baseUrl, close: closeServer } = await listen(app));
});

after(async () => {
  await closeServer();
  await cleanup();
});

async function waitForEvaluation(id: string, status: EvaluationRun['status'] = 'completed'): Promise<EvaluationRun> {
  const started = Date.now();
  for (;;) {
    const run = await app.evaluations.getRun(id);
    if (run?.status === status) return run;
    if (Date.now() - started > 5000) throw new Error(`evaluation run ${id} did not reach ${status}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('immutable evaluation datasets', () => {
  it('grades generated outputs against human ground truth stored on each dataset row', async () => {
    const { workflow } = await app.workflows.create({
      name: 'Ground truth workflow',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'e', type: 'end', config: { output: '{{workflow.input_as_text}}' } },
        ],
        edges: [{ id: 'se', source: 's', target: 'e' }],
      },
    });
    const dataset = await api('POST', `/api/v1/workflows/${workflow.id}/datasets`, {
      name: 'Human labels',
      testCases: [
        { id: 'pass', name: 'Matches', input: { input_as_text: 'Hardware' }, expectedOutput: 'Hardware', version: 0 },
        { id: 'fail', name: 'Differs', input: { input_as_text: 'Software' }, expectedOutput: 'Hardware', version: 0 },
      ],
    });
    assert.equal(dataset.status, 200);
    assert.equal(dataset.data.version.testCases[0].expectedOutput, 'Hardware');
    const created = await api('POST', `/api/v1/workflows/${workflow.id}/evaluations`, {
      name: 'Ground truth evaluation',
      graders: [{ id: 'reference', name: 'Human label', type: 'equals', reference: 'test_case_expected' }],
      dataset: { id: dataset.data.dataset.id, version: 1 },
    });
    assert.equal(created.status, 200);
    const job = await app.evaluations.evaluate(created.data.evaluation.id);
    const completed = await waitForEvaluation(job.id);
    assert.equal(completed.results.length, 2);
    assert.deepEqual(completed.results.map((result) => result.score).sort(), [0, 1]);
    assert.equal(completed.score, 0.5);
    const reviewedRunId = completed.results[0].runId;
    const reviewed = await api('PATCH', `/api/v1/evaluation-runs/${completed.id}/results/${reviewedRunId}/annotation`, {
      rating: 'negative',
      feedback: 'Needs a more specific answer.',
    });
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.data.run.results[0].annotation.rating, 'negative');
    assert.equal(reviewed.data.run.results[0].annotation.feedback, 'Needs a more specific answer.');
    assert.equal((await api('PATCH', `/api/v1/evaluation-runs/${completed.id}/results/${reviewedRunId}/annotation`, {
      rating: 'maybe',
    })).status, 400);

    const [firstReview, secondReview] = await Promise.all(completed.results.map((result, index) => api(
      'PATCH',
      `/api/v1/evaluation-runs/${completed.id}/results/${result.runId}/annotation`,
      { rating: index === 0 ? 'positive' : 'negative', feedback: `review ${index + 1}` },
    )));
    assert.deepEqual([firstReview.status, secondReview.status], [200, 200]);
    const merged = await app.evaluations.getRun(completed.id);
    assert.deepEqual(merged?.results.map((result) => result.annotation?.feedback).sort(), ['review 1', 'review 2']);
    assert.equal(merged?.annotationRevision, 3);
  });

  it('rejects annotations until automated grading is complete', async () => {
    const { workflow } = await app.workflows.create({ name: 'Pending annotation workflow' });
    const evaluation = await app.evaluations.create({
      workflowId: workflow.id,
      name: 'Pending annotation evaluation',
      graders: [{ id: 'equals', name: 'Equals', type: 'equals', expected: 'ok' }],
      testCases: [{ id: 'case', name: 'Case', input: { input_as_text: 'ok' }, version: 0 }],
    });
    const service = app.evaluations as any;
    const originalLaunch = service.launchJob.bind(service);
    service.launchJob = () => {};
    let queued: EvaluationRun;
    try {
      queued = await app.evaluations.evaluate(evaluation.id);
    } finally {
      service.launchJob = originalLaunch;
    }
    const response = await api('PATCH', `/api/v1/evaluation-runs/${queued!.id}/results/not-ready/annotation`, {
      rating: 'positive',
    });
    assert.equal(response.status, 409);
    assert.equal(response.data.error.code, 'evaluation_not_completed');
    await app.evaluations.cancelRun(queued!.id);
  });

  it('creates append-only versions and pins evaluations to a concrete version', async () => {
    const { workflow } = await app.workflows.create({
      name: 'Dataset workflow',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'e', type: 'end', config: { output: '{{workflow.input_as_text}}' } },
        ],
        edges: [{ id: 'se', source: 's', target: 'e' }],
      },
    });
    const first = await api('POST', `/api/v1/workflows/${workflow.id}/datasets`, {
      name: 'Support cases',
      description: 'immutable test data',
      testCases: [{ id: 'case-1', name: 'First', input: { input_as_text: 'version one' }, version: 0 }],
    });
    assert.equal(first.status, 200);
    assert.equal(first.data.dataset.latestVersion, 1);
    assert.equal(first.data.version.version, 1);
    const datasetId = first.data.dataset.id as string;
    const versionOne = first.data.version;

    const second = await api('POST', `/api/v1/datasets/${datasetId}/versions`, {
      testCases: [{ id: 'case-1', name: 'Second', input: { input_as_text: 'version two' }, version: 0 }],
    });
    assert.equal(second.status, 200);
    assert.equal(second.data.version.version, 2);
    assert.equal((await api('GET', `/api/v1/datasets/${datasetId}`)).data.dataset.latestVersion, 2);
    assert.equal((await api('GET', `/api/v1/datasets/${datasetId}/versions/1`)).data.version.sha256, versionOne.sha256);
    assert.equal((await api('GET', `/api/v1/datasets/${datasetId}/versions`)).data.versions.length, 2);

    await assert.rejects(
      () => app.storage.put(COLLECTIONS.evaluationDatasetVersions, versionOne.id, { changed: true }, datasetId),
      /append-only/,
    );
    await assert.rejects(
      () => app.storage.delete(COLLECTIONS.evaluationDatasetVersions, versionOne.id),
      /append-only/,
    );

    const created = await api('POST', `/api/v1/workflows/${workflow.id}/evaluations`, {
      name: 'Pinned dataset evaluation',
      graders: [{ id: 'contains', name: 'Contains', type: 'contains', expected: 'version one' }],
      dataset: { id: datasetId, version: 1 },
    });
    assert.equal(created.status, 200);
    assert.equal(created.data.evaluation.datasetId, datasetId);
    assert.equal(created.data.evaluation.datasetVersion, 1);
    const job = await app.evaluations.evaluate(created.data.evaluation.id);
    const completed = await waitForEvaluation(job.id);
    assert.equal(completed.datasetSnapshot?.version, 1);
    assert.equal(completed.definitionSnapshot?.testCases[0].input.input_as_text, 'version one');
    assert.equal(completed.results[0].score, 1);
  });

  it('recovers from the dataset snapshot after a newer version is published', async () => {
    const { workflow } = await app.workflows.create({
      name: 'Dataset recovery',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'e', type: 'end', config: { output: '{{workflow.input_as_text}}' } },
        ],
        edges: [{ id: 'se', source: 's', target: 'e' }],
      },
    });
    const dataset = await app.evaluations.createDataset({
      workflowId: workflow.id,
      name: 'Recovery cases',
      testCases: [{ id: 'case-a', name: 'A', input: { input_as_text: 'original dataset' }, version: 0 }],
    });
    const evaluation = await app.evaluations.create({
      workflowId: workflow.id,
      name: 'Recovery evaluation',
      graders: [{ id: 'contains', name: 'Contains', type: 'contains', expected: 'original dataset' }],
      dataset: { id: dataset.dataset.id },
    });
    const service = app.evaluations as any;
    const originalLaunch = service.launchJob.bind(service);
    service.launchJob = () => {};
    let queued: EvaluationRun;
    try {
      queued = await app.evaluations.evaluate(evaluation.id);
    } finally {
      service.launchJob = originalLaunch;
    }
    await app.evaluations.createDatasetVersion(dataset.dataset.id, [{
      id: 'case-a', name: 'A newer version', input: { input_as_text: 'new dataset' }, version: 0,
    }]);
    assert.equal(await app.evaluations.recoverPendingRuns(), 1);
    const recovered = await waitForEvaluation(queued!.id);
    assert.equal(recovered.datasetSnapshot?.version, 1);
    assert.equal(recovered.definitionSnapshot?.testCases[0].input.input_as_text, 'original dataset');
    assert.equal(recovered.results[0].score, 1);
  });
});
