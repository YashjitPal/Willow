import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { COLLECTIONS } from '../src/storage/index.ts';
import { listen, makeApp, type App } from './helpers.ts';

let app: App;
let cleanup: () => Promise<void>;
let closeServer: () => Promise<void>;
let baseUrl = '';

async function request(method: string, path: string, body?: unknown, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
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

describe('evaluation ownership isolation', () => {
  it('protects definitions, datasets, versions, and evaluation runs across direct IDs', async () => {
    const admin = await request('POST', '/api/v1/admin/api-keys', { name: 'Evaluation admin', role: 'admin' });
    const owner = await request('POST', '/api/v1/admin/api-keys', { name: 'Evaluation owner', role: 'publisher', subjectId: 'eval-owner', workspaceId: 'acme' }, admin.data.token);
    const intruder = await request('POST', '/api/v1/admin/api-keys', { name: 'Evaluation intruder', role: 'publisher', subjectId: 'eval-intruder', workspaceId: 'acme' }, admin.data.token);
    const defaultOwner = await request('POST', '/api/v1/admin/api-keys', { name: 'Legacy evaluation owner', role: 'publisher', subjectId: 'default', workspaceId: 'default' }, admin.data.token);
    const otherWorkspaceAdmin = await request('POST', '/api/v1/admin/api-keys', { name: 'Other evaluation workspace admin', role: 'admin', subjectId: 'other-eval-admin', workspaceId: 'other' }, admin.data.token);

    const workflow = await request('POST', '/api/v1/workflows', {
      name: 'Owned evaluation workflow',
      graph: { nodes: [
        { id: 's', type: 'start', data: {} },
        { id: 'e', type: 'end', config: { output: '{{workflow.input_as_text}}' } },
      ], edges: [{ id: 'se', source: 's', target: 'e' }] },
    }, owner.data.token);
    const workflowId = workflow.data.workflow.id;
    const dataset = await request('POST', `/api/v1/workflows/${workflowId}/datasets`, {
      name: 'Owned cases',
      testCases: [{ id: 'case-1', name: 'Case', input: { input_as_text: 'owned marker' }, version: 0 }],
    }, owner.data.token);
    assert.equal(dataset.status, 200);
    assert.deepEqual([dataset.data.dataset.ownerId, dataset.data.dataset.workspaceId], ['eval-owner', 'acme']);
    assert.deepEqual([dataset.data.version.ownerId, dataset.data.version.workspaceId], ['eval-owner', 'acme']);
    const datasetId = dataset.data.dataset.id;

    const evaluation = await request('POST', `/api/v1/workflows/${workflowId}/evaluations`, {
      name: 'Owned evaluation',
      graders: [{ id: 'contains', name: 'Contains', type: 'contains', expected: 'owned marker' }],
      dataset: { id: datasetId, version: 1 },
    }, owner.data.token);
    assert.equal(evaluation.status, 200);
    assert.deepEqual([evaluation.data.evaluation.ownerId, evaluation.data.evaluation.workspaceId], ['eval-owner', 'acme']);
    const evaluationId = evaluation.data.evaluation.id;

    const job = await request('POST', `/api/v1/evaluations/${evaluationId}/run`, {}, owner.data.token);
    assert.equal(job.status, 200);
    assert.deepEqual([job.data.run.ownerId, job.data.run.workspaceId], ['eval-owner', 'acme']);
    const evaluationRunId = job.data.run.id;

    for (const path of [
      `/api/v1/datasets/${datasetId}`,
      `/api/v1/datasets/${datasetId}/versions`,
      `/api/v1/datasets/${datasetId}/versions/1`,
      `/api/v1/evaluations/${evaluationId}`,
      `/api/v1/evaluations/${evaluationId}/runs`,
      `/api/v1/evaluation-runs/${evaluationRunId}`,
    ]) assert.equal((await request('GET', path, undefined, intruder.data.token)).status, 404);
    assert.equal((await request('POST', `/api/v1/datasets/${datasetId}/versions`, { testCases: [{ id: 'x', name: 'X', input: {}, version: 0 }] }, intruder.data.token)).status, 404);
    assert.equal((await request('PATCH', `/api/v1/evaluations/${evaluationId}`, { name: 'stolen' }, intruder.data.token)).status, 404);
    assert.equal((await request('DELETE', `/api/v1/evaluations/${evaluationId}`, undefined, intruder.data.token)).status, 404);
    assert.equal((await request('POST', `/api/v1/evaluations/${evaluationId}/run`, {}, intruder.data.token)).status, 404);
    assert.equal((await request('POST', `/api/v1/evaluation-runs/${evaluationRunId}/cancel`, {}, intruder.data.token)).status, 404);
    assert.equal((await request('POST', `/api/v1/evaluation-runs/${evaluationRunId}/resume`, {}, intruder.data.token)).status, 404);
    assert.equal((await request('GET', `/api/v1/evaluations/${evaluationId}`, undefined, admin.data.token)).status, 200);
    assert.equal((await request('GET', `/api/v1/evaluation-runs/${evaluationRunId}`, undefined, admin.data.token)).status, 200);
    assert.equal((await request('GET', `/api/v1/evaluations/${evaluationId}`, undefined, otherWorkspaceAdmin.data.token)).status, 404);
    assert.equal((await request('GET', `/api/v1/evaluation-runs/${evaluationRunId}`, undefined, otherWorkspaceAdmin.data.token)).status, 404);
    assert.equal((await request('GET', `/api/v1/datasets/${datasetId}`, undefined, otherWorkspaceAdmin.data.token)).status, 404);

    const intruderWorkflow = await request('POST', '/api/v1/workflows', { name: 'Intruder workflow' }, intruder.data.token);
    const crossPin = await request('POST', `/api/v1/workflows/${intruderWorkflow.data.workflow.id}/evaluations`, {
      name: 'Cross owner pin',
      graders: [{ id: 'contains', name: 'Contains', type: 'contains', expected: 'owned marker' }],
      dataset: { id: datasetId, version: 1 },
    }, intruder.data.token);
    assert.equal(crossPin.status, 404);

    const legacyWorkflow = await app.workflows.create({ name: 'Legacy evaluation workflow' });
    const legacyWorkflowId = legacyWorkflow.workflow.id;
    const legacyDataset = { ...structuredClone(dataset.data.dataset), id: 'eds_legacy_owner', workflowId: legacyWorkflowId };
    const legacyVersion = { ...structuredClone(dataset.data.version), id: 'eds_legacy_owner@1', datasetId: legacyDataset.id, workflowId: legacyWorkflowId };
    const legacyEvaluation = { ...structuredClone(evaluation.data.evaluation), id: 'eval_legacy_owner', workflowId: legacyWorkflowId, datasetId: legacyDataset.id };
    const legacyRun = { ...structuredClone(job.data.run), id: 'evalrun_legacy_owner', evaluationId: legacyEvaluation.id, workflowId: legacyWorkflowId, status: 'completed' };
    for (const record of [legacyDataset, legacyVersion, legacyEvaluation, legacyRun]) { delete record.ownerId; delete record.workspaceId; }
    await app.storage.put(COLLECTIONS.evaluationDatasets, legacyDataset.id, legacyDataset, legacyWorkflowId);
    await app.storage.putIfAbsent(COLLECTIONS.evaluationDatasetVersions, legacyVersion.id, legacyVersion, legacyDataset.id);
    await app.storage.put(COLLECTIONS.evaluations, legacyEvaluation.id, legacyEvaluation, legacyWorkflowId);
    await app.storage.put(COLLECTIONS.evaluationRuns, legacyRun.id, legacyRun, legacyEvaluation.id);
    assert.equal((await request('GET', `/api/v1/datasets/${legacyDataset.id}`, undefined, defaultOwner.data.token)).status, 200);
    assert.equal((await request('GET', `/api/v1/datasets/${legacyDataset.id}/versions/1`, undefined, defaultOwner.data.token)).status, 200);
    assert.equal((await request('GET', `/api/v1/evaluations/${legacyEvaluation.id}`, undefined, defaultOwner.data.token)).status, 200);
    assert.equal((await request('GET', `/api/v1/evaluation-runs/${legacyRun.id}`, undefined, defaultOwner.data.token)).status, 200);
    assert.equal((await request('GET', `/api/v1/evaluations/${legacyEvaluation.id}`, undefined, intruder.data.token)).status, 404);
    assert.equal((await request('PATCH', `/api/v1/evaluations/${legacyEvaluation.id}`, { name: 'Migrated legacy evaluation' }, defaultOwner.data.token)).status, 200);
    const persisted = await app.storage.get<any>(COLLECTIONS.evaluations, legacyEvaluation.id);
    assert.deepEqual([persisted?.ownerId, persisted?.workspaceId], ['default', 'default']);
  });
});
