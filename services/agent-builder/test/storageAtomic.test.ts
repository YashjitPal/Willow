import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { JsonFileStorage } from '../src/storage/jsonfile.ts';
import { SqliteStorage } from '../src/storage/sqlite.ts';
import type { Storage } from '../src/storage/index.ts';
import { COLLECTIONS } from '../src/storage/index.ts';
import { DeploymentConflictError, DeploymentService } from '../src/services/deployments.ts';
import { WorkflowService } from '../src/services/workflows.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function assertAtomic(factory: (dir: string) => Storage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-atomic-'));
  dirs.push(dir);
  const first = factory(dir);
  const second = factory(dir);
  try {
    const attempts = await Promise.all(Array.from({ length: 40 }, (_, index) => {
      const storage = index % 2 === 0 ? first : second;
      return storage.putIfAbsent('idempotency', 'same-key', { owner: index });
    }));
    assert.equal(attempts.filter(Boolean).length, 1);
    const a = await first.get('idempotency', 'same-key');
    const b = await second.get('idempotency', 'same-key');
    assert.deepEqual(a, b);
  } finally {
    await first.close();
    await second.close();
  }
}

async function assertInterruptedPublishRecovery() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-publish-recovery-'));
  dirs.push(dir);
  const workflowId = 'wf_publish_recovery';
  const versionId = `${workflowId}@1`;
  const draft = { id: workflowId, draftRevision: 4, latestVersion: 0 };
  const publishedWorkflow = { ...draft, draftRevision: 5, latestVersion: 1 };
  const version = { id: versionId, workflowId, version: 1, graph: { nodes: [], edges: [] } };

  const beforeRestart = new JsonFileStorage(dir);
  await beforeRestart.put(COLLECTIONS.workflows, workflowId, draft);
  // Simulate a stop after the immutable version commit and before the workflow
  // pointer commit in publishWorkflowVersion.
  assert.equal(await beforeRestart.putIfAbsent(COLLECTIONS.versions, versionId, version, workflowId), true);
  await beforeRestart.close();

  const afterRestart = new JsonFileStorage(dir);
  try {
    assert.deepEqual(await afterRestart.publishWorkflowVersion({
      workflowId,
      expectedDraftRevision: 4,
      workflow: publishedWorkflow,
      versionId,
      version,
      dependencies: [],
    }), { status: 'published' });
    assert.deepEqual(await afterRestart.get(COLLECTIONS.workflows, workflowId), publishedWorkflow);
    assert.deepEqual(await afterRestart.get(COLLECTIONS.versions, versionId), version);

    await afterRestart.put(COLLECTIONS.workflows, workflowId, { ...publishedWorkflow, draftRevision: 6 });
    await assert.rejects(() => afterRestart.publishWorkflowVersion({
      workflowId,
      expectedDraftRevision: 6,
      workflow: { ...publishedWorkflow, draftRevision: 7 },
      versionId,
      version: { ...version, graph: { nodes: [{ id: 'conflict' }], edges: [] } },
      dependencies: [],
    }), /already exists/);
  } finally { await afterRestart.close(); }
}

async function assertCompareAndDelete(factory: (dir: string) => Storage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-compare-delete-'));
  dirs.push(dir);
  const storage = factory(dir);
  try {
    await storage.put('leases', 'tab', { expiresAt: 'old', value: 1 });
    await storage.put('leases', 'tab', { expiresAt: 'refreshed', value: 2 });
    assert.equal(await storage.compareAndDelete('leases', 'tab', 'expiresAt', 'old'), false);
    assert.deepEqual(await storage.get('leases', 'tab'), { expiresAt: 'refreshed', value: 2 });
    assert.equal(await storage.compareAndDelete('leases', 'tab', 'expiresAt', 'refreshed'), true);
    assert.equal(await storage.get('leases', 'tab'), undefined);
  } finally {
    await storage.close();
  }
}

async function assertDeploymentEnvironmentUnique(factory: (dir: string) => Storage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-deployment-unique-'));
  dirs.push(dir);
  const first = factory(dir);
  const second = factory(dir);
  const workflowId = 'wf_deployment_unique';
  const input = {
    workflowId,
    name: 'Production',
    environment: 'production',
    activeVersion: 1,
    allowedOrigins: [],
    sessionRateLimitPerMinute: 60,
    maxActiveSessions: 1000,
    status: 'active' as const,
  };
  try {
    await first.put(COLLECTIONS.workflows, workflowId, { id: workflowId, draftRevision: 1, latestVersion: 1 });
    await first.put(COLLECTIONS.versions, `${workflowId}@1`, { version: 1 }, workflowId);
    const results = await Promise.allSettled([
      new DeploymentService(first).create(input, 'first'),
      new DeploymentService(second).create(input, 'second'),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    const rejection = results.find((result) => result.status === 'rejected');
    assert.ok(rejection && rejection.reason instanceof DeploymentConflictError);
    assert.equal((await first.list(COLLECTIONS.deployments, { ref: workflowId })).length, 1);
    assert.equal((await first.list(COLLECTIONS.deploymentReleases)).length, 1);
  } finally {
    await first.close();
    await second.close();
  }
}

async function assertDeploymentCreateDeleteRace(factory: (dir: string) => Storage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-deployment-delete-race-'));
  dirs.push(dir);
  const first = factory(dir);
  const second = factory(dir);
  const workflowId = 'wf_deployment_delete_race';
  const input = {
    workflowId,
    name: 'Production',
    environment: 'production',
    activeVersion: 1,
    allowedOrigins: [],
    sessionRateLimitPerMinute: 60,
    maxActiveSessions: 1000,
    status: 'active' as const,
  };
  try {
    await first.put(COLLECTIONS.workflows, workflowId, { id: workflowId, draftRevision: 1, latestVersion: 1 });
    await first.put(COLLECTIONS.versions, `${workflowId}@1`, { workflowId, version: 1, graph: { nodes: [], edges: [] } }, workflowId);
    const [creation, deletion] = await Promise.allSettled([
      new DeploymentService(first).create(input, 'creator'),
      second.deleteWorkflowIfUnreferenced(workflowId),
    ]);
    if (creation.status === 'fulfilled') {
      assert.equal(deletion.status, 'fulfilled');
      assert.equal(deletion.value.status, 'blocked');
      assert.ok(await second.get(COLLECTIONS.workflows, workflowId));
      assert.ok(await second.get(COLLECTIONS.versions, `${workflowId}@1`));
      assert.ok(await second.get(COLLECTIONS.deployments, creation.value.id));
      assert.ok(await second.get(COLLECTIONS.deploymentReleases, creation.value.activeReleaseId));
    } else {
      assert.match(String(creation.reason), /no published version 1/);
      assert.equal(deletion.status, 'fulfilled');
      assert.equal(deletion.value.status, 'deleted');
      assert.equal((await second.list(COLLECTIONS.deployments, { ref: workflowId })).length, 0);
      assert.equal((await second.list(COLLECTIONS.deploymentReleases)).length, 0);
    }
  } finally { await first.close(); await second.close(); }
}

async function assertWorkflowEvaluationCascade(factory: (dir: string) => Storage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-evaluation-cascade-'));
  dirs.push(dir);
  const storage = factory(dir);
  try {
    await storage.put(COLLECTIONS.workflows, 'wf-delete', { id: 'wf-delete', draftRevision: 1, latestVersion: 1 });
    await storage.put(COLLECTIONS.versions, 'wf-delete@1', { workflowId: 'wf-delete', version: 1 }, 'wf-delete');
    await storage.put(COLLECTIONS.evaluations, 'eval-delete', { id: 'eval-delete', workflowId: 'wf-delete' }, 'wf-delete');
    await storage.put(COLLECTIONS.evaluationRuns, 'evalrun-delete', { id: 'evalrun-delete', evaluationId: 'eval-delete', workflowId: 'wf-delete' }, 'eval-delete');
    await storage.put(COLLECTIONS.evaluationDatasets, 'dataset-delete', { id: 'dataset-delete', workflowId: 'wf-delete' }, 'wf-delete');
    assert.equal(await storage.putIfAbsent(COLLECTIONS.evaluationDatasetVersions, 'dataset-delete@1', { id: 'dataset-delete@1', datasetId: 'dataset-delete', workflowId: 'wf-delete' }, 'dataset-delete'), true);
    await storage.put(COLLECTIONS.workflows, 'wf-keep', { id: 'wf-keep', draftRevision: 1, latestVersion: 0 });
    await storage.put(COLLECTIONS.evaluations, 'eval-keep', { id: 'eval-keep', workflowId: 'wf-keep' }, 'wf-keep');
    await storage.put(COLLECTIONS.evaluationRuns, 'evalrun-keep', { id: 'evalrun-keep', evaluationId: 'eval-keep', workflowId: 'wf-keep' }, 'eval-keep');

    assert.deepEqual(await storage.deleteWorkflowIfUnreferenced('wf-delete'), { status: 'deleted' });
    for (const [collection, id] of [
      [COLLECTIONS.workflows, 'wf-delete'], [COLLECTIONS.versions, 'wf-delete@1'],
      [COLLECTIONS.evaluations, 'eval-delete'], [COLLECTIONS.evaluationRuns, 'evalrun-delete'],
      [COLLECTIONS.evaluationDatasets, 'dataset-delete'], [COLLECTIONS.evaluationDatasetVersions, 'dataset-delete@1'],
    ] as const) assert.equal(await storage.get(collection, id), undefined, `${collection}/${id} should be deleted`);
    assert.ok(await storage.get(COLLECTIONS.evaluations, 'eval-keep'));
    assert.ok(await storage.get(COLLECTIONS.evaluationRuns, 'evalrun-keep'));
  } finally { await storage.close(); }
}

async function assertDeploymentAdmission(factory: (dir: string) => Storage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-admission-'));
  dirs.push(dir);
  const first = factory(dir);
  const second = factory(dir);
  const now = new Date().toISOString();
  try {
    await first.put(COLLECTIONS.deployments, 'dep', { id: 'dep', workflowId: 'wf', status: 'active', mutationRevision: 0, activeReleaseId: 'rel', allowedOrigins: [], maxActiveSessions: 1, sessionRateLimitPerMinute: 100 });
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second).admitDeploymentSession({ deploymentId: 'dep', workflowId: 'wf', expectedMutationRevision: 0, expectedReleaseId: 'rel', now, rateWindowStart: new Date(Date.now() - 60_000).toISOString(), sessionId: `session-${index}`, session: { id: `session-${index}`, workflowId: 'wf', deploymentId: 'dep', status: 'active', createdAt: now, expiresAt: new Date(Date.now() + 60_000).toISOString() } })));
    assert.equal(results.filter((result) => result.status === 'inserted').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected' && result.reason === 'active_limit').length, 19);
    assert.equal((await second.list(COLLECTIONS.sessions)).length, 1);
    const stale = await first.admitDeploymentSession({ deploymentId: 'dep', workflowId: 'wf', expectedMutationRevision: 1, expectedReleaseId: 'rel', now, rateWindowStart: new Date(Date.now() - 60_000).toISOString(), sessionId: 'stale', session: {} });
    assert.equal(stale.status, 'revision_conflict');
  } finally { await first.close(); await second.close(); }
}

async function assertVectorStoreMutation(factory: (dir: string) => Storage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-vector-mutation-'));
  dirs.push(dir);
  const first = factory(dir);
  const second = factory(dir);
  try {
    await first.put(COLLECTIONS.vectorStores, 'vs_atomic', {
      id: 'vs_atomic', name: 'Atomic usage', fileCount: 0, chunkCount: 0, embedder: 'openai',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const updates = await Promise.all(Array.from({ length: 40 }, (_, index) => (index % 2 ? first : second).mutateVectorStore({
      storeId: 'vs_atomic',
      updatedAt: new Date(Date.now() + index).toISOString(),
      ...(index === 0 ? { patch: { fileCount: 7, chunkCount: 19, embedder: 'local' } } : {}),
      usage: {
        operation: 'search', operations: 1, requestCount: 2, reportedInputTokens: 3,
        unreportedTokenOperations: index % 2 === 0 ? 1 : 0,
        unpricedOperations: index % 3 === 0 ? 1 : 0,
        estimatedCostUsd: 0.0000001,
      },
    })));
    assert.ok(updates.every(Boolean));
    const store = await first.get<any>(COLLECTIONS.vectorStores, 'vs_atomic');
    assert.deepEqual([store.fileCount, store.chunkCount, store.embedder], [7, 19, 'local']);
    assert.deepEqual(store.embeddingUsage.search, {
      operations: 40,
      requestCount: 80,
      reportedInputTokens: 120,
      unreportedTokenOperations: 20,
      unpricedOperations: 14,
      estimatedCostUsd: 0.000004,
    });
    assert.equal(await second.mutateVectorStore({ storeId: 'missing', updatedAt: new Date().toISOString() }), false);
  } finally { await first.close(); await second.close(); }
}

async function assertDeploymentRunAdmission(factory: (dir: string) => Storage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-run-admission-'));
  dirs.push(dir);
  const first = factory(dir);
  const second = factory(dir);
  const now = new Date();
  const input = (admissionId: string, signature = admissionId, deploymentId = 'dep') => ({
    deploymentId,
    workflowId: 'wf',
    deploymentReleaseId: 'rel',
    admissionId,
    signature,
    now: now.toISOString(),
    rateWindowStart: new Date(now.getTime() - 60_000).toISOString(),
    dayWindowStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString(),
    reservedTokens: 0,
    reservedEstimatedCostUsd: 0,
  });
  try {
    await first.put(COLLECTIONS.deployments, 'dep', { id: 'dep', workflowId: 'wf', status: 'active', maxConcurrentRuns: 1, maxRunsPerMinute: 2, maxRunsPerDay: 3 });
    const burst = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second).admitDeploymentRun(input(`admission-${index}`))));
    assert.equal(burst.filter((result) => result.status === 'inserted').length, 1);
    assert.equal(burst.filter((result) => result.status === 'rejected' && result.reason === 'concurrent_limit').length, 19);
    const admittedIndex = burst.findIndex((result) => result.status === 'inserted');
    const admittedId = `admission-${admittedIndex}`;
    assert.equal(await first.bindDeploymentRun(admittedId, 'dep', admittedId, 'run-1'), true);
    assert.equal(await second.completeDeploymentRun(admittedId, 'dep', 'run-1', 'completed', now.toISOString()), true);
    const retry = await second.admitDeploymentRun(input(admittedId));
    assert.equal(retry.status, 'existing');
    assert.equal(await first.admitDeploymentRun(input(admittedId, 'different-signature')).then((result) => result.status), 'idempotency_conflict');

    const secondRun = await first.admitDeploymentRun(input('admission-second'));
    assert.equal(secondRun.status, 'inserted');
    assert.equal(await first.completeDeploymentRun('admission-second', 'dep', 'run-2', 'failed', now.toISOString()), true);
    const minuteLimited = await second.admitDeploymentRun(input('admission-third'));
    assert.deepEqual(minuteLimited, { status: 'rejected', reason: 'rate_limit' });

    await first.put(COLLECTIONS.deployments, 'daily', { id: 'daily', workflowId: 'wf', status: 'active', maxConcurrentRuns: 10, maxRunsPerMinute: 10, maxRunsPerDay: 1 });
    assert.equal((await first.admitDeploymentRun(input('daily-first', 'daily-first', 'daily'))).status, 'inserted');
    assert.equal(await first.completeDeploymentRun('daily-first', 'daily', 'run-daily', 'completed', now.toISOString()), true);
    assert.deepEqual(await second.admitDeploymentRun(input('daily-second', 'daily-second', 'daily')), { status: 'rejected', reason: 'daily_limit' });

    await first.put(COLLECTIONS.deployments, 'release', { id: 'release', workflowId: 'wf', status: 'active', maxConcurrentRuns: 1, maxRunsPerMinute: 10, maxRunsPerDay: 10 });
    assert.equal((await first.admitDeploymentRun(input('released-first', 'released-first', 'release'))).status, 'inserted');
    assert.equal(await first.releaseDeploymentRun('released-first', 'release', 'released-first'), true);
    assert.equal((await second.admitDeploymentRun(input('released-second', 'released-second', 'release'))).status, 'inserted');

    await first.put(COLLECTIONS.deployments, 'budget', { id: 'budget', workflowId: 'wf', status: 'active', maxConcurrentRuns: 10, maxRunsPerMinute: 10, maxRunsPerDay: 10, maxTokensPerDay: 10, maxEstimatedCostUsdPerDay: 0.01 });
    const reserved = { ...input('budget-first', 'budget-first', 'budget'), reservedTokens: 6, reservedEstimatedCostUsd: 0.006 };
    assert.equal((await first.admitDeploymentRun(reserved)).status, 'inserted');
    assert.deepEqual(await second.admitDeploymentRun({ ...input('budget-token', 'budget-token', 'budget'), reservedTokens: 5, reservedEstimatedCostUsd: 0.001 }), { status: 'rejected', reason: 'token_limit' });
    assert.deepEqual(await second.admitDeploymentRun({ ...input('budget-cost', 'budget-cost', 'budget'), reservedTokens: 4, reservedEstimatedCostUsd: 0.005 }), { status: 'rejected', reason: 'cost_limit' });
    assert.equal(await second.completeDeploymentRun('budget-first', 'budget', 'run-budget', 'completed', now.toISOString(), { inputTokens: 7, outputTokens: 5, embeddingInputTokens: 3, estimatedCostUsd: 0.012, unpricedLlmCalls: 0, unpricedEmbeddingOperations: 1 }), true);
    const settled = await first.get<any>(COLLECTIONS.deploymentRunAdmissions, 'budget-first');
    assert.deepEqual({ actualTokens: settled.actualTokens, tokenOverage: settled.tokenOverage, actualEstimatedCostUsd: settled.actualEstimatedCostUsd, estimatedCostUsdOverage: settled.estimatedCostUsdOverage, actualUnpricedEmbeddingOperations: settled.actualUnpricedEmbeddingOperations }, { actualTokens: 15, tokenOverage: 9, actualEstimatedCostUsd: 0.012, estimatedCostUsdOverage: 0.006, actualUnpricedEmbeddingOperations: 1 });
    assert.deepEqual(await second.admitDeploymentRun({ ...input('budget-after-overage', 'budget-after-overage', 'budget'), reservedTokens: 1, reservedEstimatedCostUsd: 0 }), { status: 'rejected', reason: 'token_limit' });

    await first.put(COLLECTIONS.deployments, 'embedding-cost', { id: 'embedding-cost', workflowId: 'wf', status: 'active', maxConcurrentRuns: 10, maxRunsPerMinute: 10, maxRunsPerDay: 10, maxEstimatedCostUsdPerDay: 1 });
    assert.equal((await first.admitDeploymentRun({ ...input('embedding-cost-first', 'embedding-cost-first', 'embedding-cost'), reservedTokens: 0, reservedEstimatedCostUsd: 0 })).status, 'inserted');
    assert.equal(await first.completeDeploymentRun('embedding-cost-first', 'embedding-cost', 'run-embedding-cost', 'completed', now.toISOString(), { inputTokens: 0, outputTokens: 0, embeddingInputTokens: 0, estimatedCostUsd: 0, unpricedLlmCalls: 0, unpricedEmbeddingOperations: 1 }), true);
    assert.deepEqual(await second.admitDeploymentRun({ ...input('embedding-cost-second', 'embedding-cost-second', 'embedding-cost'), reservedTokens: 0, reservedEstimatedCostUsd: 0 }), { status: 'rejected', reason: 'unpriced_cost' });
  } finally { await first.close(); await second.close(); }
}

async function assertDeploymentRunReconciliation(factory: (dir: string) => Storage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-run-reconcile-'));
  dirs.push(dir);
  const seed = factory(dir);
  let seedClosed = false;
  let restarted: Storage | undefined;
  const now = new Date('2026-07-17T03:00:00.000Z');
  const old = new Date(now.getTime() - 2 * 60_000).toISOString();
  const admission = (id: string, deploymentId: string, status: string, createdAt: string, runId?: string, completedAt?: string) => ({ id, deploymentId, workflowId: 'wf', deploymentReleaseId: 'rel', signature: `sig-${id}`, status, createdAt, runId, completedAt, reservedTokens: 10, reservedEstimatedCostUsd: 0.01 });
  const run = (id: string, deploymentId: string, admissionId: string, status: string) => ({ id, workflowId: 'wf', workflowVersion: 1, deploymentId, deploymentReleaseId: 'rel', deploymentRunAdmissionId: admissionId, status, input: {}, usage: { inputTokens: 1, outputTokens: 1, llmCalls: 1, toolCalls: 0, estimatedCostUsd: 0, unpricedLlmCalls: 0, pricingCatalogVersion: 'test', byModel: {} }, createdAt: old, endedAt: status === 'completed' || status === 'failed' || status === 'cancelled' ? now.toISOString() : undefined });
  try {
    await seed.put(COLLECTIONS.deploymentRunAdmissions, 'repair', admission('repair', 'dep-repair', 'active', old, 'run-repair'), 'dep-repair');
    await seed.put(COLLECTIONS.runs, 'run-repair', run('run-repair', 'dep-repair', 'repair', 'completed'), 'wf');
    await seed.put(COLLECTIONS.deploymentRunAdmissions, 'settled', admission('settled', 'dep-settled', 'completed', old, 'run-settled', now.toISOString()), 'dep-settled');
    await seed.put(COLLECTIONS.runs, 'run-settled', run('run-settled', 'dep-settled', 'settled', 'completed'), 'wf');
    await seed.put(COLLECTIONS.deploymentRunAdmissions, 'live-bound', admission('live-bound', 'dep-live', 'active', old, 'run-live'), 'dep-live');
    await seed.put(COLLECTIONS.runs, 'run-live', run('run-live', 'dep-live', 'live-bound', 'running'), 'wf');
    await seed.put(COLLECTIONS.deploymentRunAdmissions, 'live-unbound', admission('live-unbound', 'dep-unbound', 'reserved', old), 'dep-unbound');
    await seed.put(COLLECTIONS.runs, 'run-unbound', run('run-unbound', 'dep-unbound', 'live-unbound', 'queued'), 'wf');
    await seed.put(COLLECTIONS.deploymentRunAdmissions, 'stale', admission('stale', 'dep-stale', 'reserved', old), 'dep-stale');
    await seed.put(COLLECTIONS.deploymentRunAdmissions, 'fresh', admission('fresh', 'dep-fresh', 'reserved', now.toISOString()), 'dep-fresh');
    await seed.put(COLLECTIONS.deploymentRunAdmissions, 'orphan', admission('orphan', 'dep-orphan', 'active', old, 'run-missing'), 'dep-orphan');
    await seed.put(COLLECTIONS.deployments, 'dep-orphan', { id: 'dep-orphan', workflowId: 'wf', status: 'active', maxConcurrentRuns: 1, maxRunsPerMinute: 10, maxRunsPerDay: 10, maxTokensPerDay: 10, maxEstimatedCostUsdPerDay: 0.01 });
    await seed.close();
    seedClosed = true;
    restarted = factory(dir);

    const service = new DeploymentService(restarted);
    assert.deepEqual(await service.reconcileRunAdmissions({ now, staleAfterMs: 60_000 }), {
      scanned: 7,
      settled: 3,
      alreadySettled: 0,
      reboundLive: 1,
      retainedLive: 2,
      retainedFresh: 1,
      releasedStale: 1,
      orphanedBound: 1,
    });
    assert.equal((await restarted.get<any>(COLLECTIONS.deploymentRunAdmissions, 'repair'))?.status, 'completed');
    const repairedSettlement = await restarted.get<any>(COLLECTIONS.deploymentRunAdmissions, 'settled');
    assert.deepEqual({
      status: repairedSettlement?.status,
      actualTokens: repairedSettlement?.actualTokens,
      actualEstimatedCostUsd: repairedSettlement?.actualEstimatedCostUsd,
    }, { status: 'completed', actualTokens: 2, actualEstimatedCostUsd: 0 });
    assert.equal((await restarted.get<any>(COLLECTIONS.deploymentRunAdmissions, 'live-unbound'))?.runId, 'run-unbound');
    assert.equal(await restarted.get(COLLECTIONS.deploymentRunAdmissions, 'stale'), undefined);
    assert.equal((await restarted.get<any>(COLLECTIONS.deploymentRunAdmissions, 'fresh'))?.status, 'reserved');
    const orphan = await restarted.get<any>(COLLECTIONS.deploymentRunAdmissions, 'orphan');
    assert.deepEqual({ status: orphan?.status, actualTokens: orphan?.actualTokens, actualEstimatedCostUsd: orphan?.actualEstimatedCostUsd, completedAt: orphan?.completedAt }, { status: 'failed', actualTokens: 0, actualEstimatedCostUsd: 0, completedAt: now.toISOString() });
    const replacement = await restarted.admitDeploymentRun({
      deploymentId: 'dep-orphan', workflowId: 'wf', deploymentReleaseId: 'rel', admissionId: 'replacement', signature: 'replacement',
      now: now.toISOString(), rateWindowStart: new Date(now.getTime() - 60_000).toISOString(), dayWindowStart: new Date(now.getTime() - 24 * 60 * 60_000).toISOString(),
      reservedTokens: 10, reservedEstimatedCostUsd: 0.01,
    });
    assert.equal(replacement.status, 'inserted');

    const secondPass = await service.reconcileRunAdmissions({ now, staleAfterMs: 60_000 });
    assert.equal(secondPass.settled, 0);
    assert.equal(secondPass.releasedStale, 0);
    assert.equal(secondPass.alreadySettled, 3);
  } finally { if (!seedClosed) await seed.close(); await restarted?.close(); }
}

async function assertSubflowPublishDeleteRace(factory: (dir: string) => Storage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-subflow-race-'));
  dirs.push(dir);
  const first = factory(dir);
  const second = factory(dir);
  try {
    await first.put(COLLECTIONS.workflows, 'child', { id: 'child', draftRevision: 1, latestVersion: 1 });
    await first.put(COLLECTIONS.versions, 'child@1', { workflowId: 'child', version: 1, graph: { nodes: [], edges: [] } }, 'child');
    await first.put(COLLECTIONS.workflows, 'parent', { id: 'parent', draftRevision: 1, latestVersion: 0 });
    const dependency = { nodeId: 'call', workflowId: 'child', version: 1 };
    const [published, deleted] = await Promise.all([
      first.publishWorkflowVersion({ workflowId: 'parent', expectedDraftRevision: 1, workflow: { id: 'parent', draftRevision: 2, latestVersion: 1 }, versionId: 'parent@1', version: { workflowId: 'parent', version: 1, graph: { nodes: [], edges: [] }, dependencies: [dependency] }, dependencies: [dependency] }),
      second.deleteWorkflowIfUnreferenced('child'),
    ]);
    if (published.status === 'published') {
      assert.equal(deleted.status, 'blocked');
      assert.ok(await second.get(COLLECTIONS.workflows, 'child'));
      assert.ok(await second.get(COLLECTIONS.versions, 'parent@1'));
    } else {
      assert.equal(published.status, 'missing_dependency');
      assert.equal(deleted.status, 'deleted');
      assert.equal(await first.get(COLLECTIONS.workflows, 'child'), undefined);
      assert.equal(await first.get(COLLECTIONS.versions, 'parent@1'), undefined);
    }
  } finally { await first.close(); await second.close(); }
}

async function assertCompareAndSwap(factory: (dir: string) => Storage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-cas-'));
  dirs.push(dir);
  const seed = factory(dir);
  await seed.put('workflows', 'wf', { draftRevision: 1, owner: 'seed' });
  await seed.close();
  const first = factory(dir);
  const second = factory(dir);
  try {
    const results = await Promise.all([
      first.compareAndSwap('workflows', 'wf', 'draftRevision', 1, { draftRevision: 2, owner: 'first' }),
      second.compareAndSwap('workflows', 'wf', 'draftRevision', 1, { draftRevision: 2, owner: 'second' }),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    const current = await first.get<{ draftRevision: number; owner: string }>('workflows', 'wf');
    assert.equal(current?.draftRevision, 2);
    assert.ok(['first', 'second'].includes(current?.owner ?? ''));
  } finally {
    await first.close();
    await second.close();
  }
}

async function assertMixedPutAndCas(factory: (dir: string) => Storage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-mixed-'));
  dirs.push(dir);
  const seed = factory(dir);
  await seed.put('workflows', 'target', { draftRevision: 1, value: 'old' });
  await seed.close();
  const first = factory(dir);
  const second = factory(dir);
  try {
    await Promise.all([
      first.compareAndSwap('workflows', 'target', 'draftRevision', 1, { draftRevision: 2, value: 'new' }),
      second.put('workflows', 'unrelated', { draftRevision: 1, value: 'kept' }),
    ]);
    const reopened = factory(dir);
    try {
      assert.equal((await reopened.get<any>('workflows', 'target'))?.draftRevision, 2);
      assert.equal((await reopened.get<any>('workflows', 'unrelated'))?.value, 'kept');
    } finally { await reopened.close(); }
  } finally { await first.close(); await second.close(); }
}

async function assertBatchRollback(factory: (dir: string) => Storage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-batch-'));
  dirs.push(dir);
  const storage = factory(dir);
  try {
    await storage.put('workflows', 'wf', { draftRevision: 1, latestVersion: 0 });
    await storage.put('versions', 'wf@1', { version: 1 }, 'wf');
    await assert.rejects(() => storage.compareAndSwapWithPut(
      'workflows', 'wf', 'draftRevision', 1, { draftRevision: 2, latestVersion: 1 },
      'versions', 'wf@1', { version: 1 }, 'wf',
    ));
    assert.deepEqual(await storage.get('workflows', 'wf'), { draftRevision: 1, latestVersion: 0 });
  } finally { await storage.close(); }
}

describe('atomic storage claims', () => {
  it('conditionally deletes one JSON lease without removing a refresh', () => assertCompareAndDelete((dir) => new JsonFileStorage(dir)));
  it('conditionally deletes one SQLite lease without removing a refresh', () => assertCompareAndDelete((dir) => new SqliteStorage(path.join(dir, 'data.sqlite'))));
  it('durably reopens acknowledged JSON state for critical lifecycle collections', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-durable-reopen-'));
    dirs.push(dir);
    const snapshots: Array<[string, string, Record<string, unknown>, string | undefined]> = [
      [COLLECTIONS.workflows, 'wf-durable', { id: 'wf-durable', draftRevision: 7, graph: { nodes: [], edges: [] } }, undefined],
      [COLLECTIONS.versions, 'wf-durable@3', { workflowId: 'wf-durable', version: 3 }, 'wf-durable'],
      [COLLECTIONS.deployments, 'dep-durable', { id: 'dep-durable', workflowId: 'wf-durable', mutationRevision: 4 }, 'wf-durable'],
      [COLLECTIONS.runs, 'run-durable', { id: 'run-durable', workflowId: 'wf-durable', status: 'awaiting_approval', checkpoint: { nodeId: 'approval' } }, 'wf-durable'],
      [COLLECTIONS.evaluationRuns, 'evalrun-durable', { id: 'evalrun-durable', evaluationId: 'eval-durable', status: 'running', completedRuns: 2 }, 'eval-durable'],
    ];

    const first = new JsonFileStorage(dir);
    for (const [collection, id, doc, ref] of snapshots) await first.put(collection, id, doc, ref);
    // Reopen without close(): every resolved mutation must already be durable,
    // rather than depending on the graceful-shutdown backstop.
    const reopened = new JsonFileStorage(dir);
    try {
      for (const [collection, id, doc] of snapshots) assert.deepEqual(await reopened.get(collection, id), doc);
      const storeFiles = fs.readdirSync(path.join(dir, 'store'));
      assert.equal(storeFiles.some((name) => name.endsWith('.tmp')), false);
    } finally {
      await reopened.close();
      await first.close();
    }
  });

  it('normalizes legacy workflows without a draft revision when listing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-legacy-list-'));
    dirs.push(dir);
    const storage = new JsonFileStorage(dir);
    try {
      await storage.put(COLLECTIONS.workflows, 'wf_legacy', {
        id: 'wf_legacy', name: 'Legacy', draft: { nodes: [], edges: [] }, latestVersion: 0,
        createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
      });
      const workflows = await new WorkflowService(storage).list();
      assert.equal(workflows.find((workflow) => workflow.id === 'wf_legacy')?.draftRevision, 0);
    } finally {
      await storage.close();
    }
  });

  it('selects one winner across JSON storage instances', async () => {
    await assertAtomic((dir) => new JsonFileStorage(dir));
  });

  it('selects one winner across SQLite connections', async () => {
    await assertAtomic((dir) => new SqliteStorage(path.join(dir, 'claims.db')));
  });

  it('finishes an identical JSON publish interrupted between durable commits', async () => {
    await assertInterruptedPublishRecovery();
  });

  it('creates one deployment per workflow/environment across JSON instances', async () => {
    await assertDeploymentEnvironmentUnique((dir) => new JsonFileStorage(dir));
  });

  it('creates one deployment per workflow/environment across SQLite connections', async () => {
    await assertDeploymentEnvironmentUnique((dir) => new SqliteStorage(path.join(dir, 'deployment-unique.db')));
  });

  it('serializes deployment creation against JSON workflow deletion', async () => {
    await assertDeploymentCreateDeleteRace((dir) => new JsonFileStorage(dir));
  });

  it('serializes deployment creation against SQLite workflow deletion', async () => {
    await assertDeploymentCreateDeleteRace((dir) => new SqliteStorage(path.join(dir, 'deployment-delete-race.db')));
  });

  it('atomically cascades workflow evaluation records in JSON storage', async () => {
    await assertWorkflowEvaluationCascade((dir) => new JsonFileStorage(dir));
  });

  it('atomically cascades workflow evaluation records in SQLite storage', async () => {
    await assertWorkflowEvaluationCascade((dir) => new SqliteStorage(path.join(dir, 'evaluation-cascade.db')));
  });

  it('admits one quota-bounded session across JSON storage instances', async () => {
    await assertDeploymentAdmission((dir) => new JsonFileStorage(dir));
  });

  it('admits one quota-bounded session across SQLite connections', async () => {
    await assertDeploymentAdmission((dir) => new SqliteStorage(path.join(dir, 'admission.db')));
  });

  it('accumulates vector usage and patches atomically across JSON storage instances', async () => {
    await assertVectorStoreMutation((dir) => new JsonFileStorage(dir));
  });

  it('accumulates vector usage and patches atomically across SQLite connections', async () => {
    await assertVectorStoreMutation((dir) => new SqliteStorage(path.join(dir, 'vector-mutation.db')));
  });

  it('admits and settles quota-bounded runs across JSON storage instances', async () => {
    await assertDeploymentRunAdmission((dir) => new JsonFileStorage(dir));
  });

  it('admits and settles quota-bounded runs across SQLite connections', async () => {
    await assertDeploymentRunAdmission((dir) => new SqliteStorage(path.join(dir, 'run-admission.db')));
  });

  it('reconciles deployment run reservations after a JSON storage restart', async () => {
    await assertDeploymentRunReconciliation((dir) => new JsonFileStorage(dir));
  });

  it('reconciles deployment run reservations after a SQLite storage restart', async () => {
    await assertDeploymentRunReconciliation((dir) => new SqliteStorage(path.join(dir, 'run-reconcile.db')));
  });

  it('serializes subflow publication against JSON workflow deletion', async () => {
    await assertSubflowPublishDeleteRace((dir) => new JsonFileStorage(dir));
  });

  it('serializes subflow publication against SQLite workflow deletion', async () => {
    await assertSubflowPublishDeleteRace((dir) => new SqliteStorage(path.join(dir, 'subflow-race.db')));
  });

  it('compares and swaps one JSON workflow revision across instances', async () => {
    await assertCompareAndSwap((dir) => new JsonFileStorage(dir));
  });

  it('compares and swaps one SQLite workflow revision across connections', async () => {
    await assertCompareAndSwap((dir) => new SqliteStorage(path.join(dir, 'cas.db')));
  });

  it('preserves mixed JSON put and CAS mutations across instances', async () => {
    await assertMixedPutAndCas((dir) => new JsonFileStorage(dir));
  });

  it('preserves mixed SQLite put and CAS mutations across connections', async () => {
    await assertMixedPutAndCas((dir) => new SqliteStorage(path.join(dir, 'mixed.db')));
  });

  it('does not expose a JSON workflow pointer when version insertion fails', async () => {
    await assertBatchRollback((dir) => new JsonFileStorage(dir));
  });

  it('retries a failed debounced JSON flush instead of losing the dirty collection', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-flush-retry-'));
    dirs.push(dir);
    const storage: any = new JsonFileStorage(dir);
    await storage.put('settings', 'retry', { value: 'old' });
    const map = (storage as any).collections.get('settings') as Map<string, any>;
    map.get('retry').doc = { value: 'new' };
    storage.dirty.add('settings');
    const original = storage.durableReplace;
    let failures = 0;
    storage.durableReplace = function (...args: any[]) {
      if (failures++ === 0) throw new Error('transient filesystem failure');
      return original.apply(this, args);
    };
    storage.flushSync();
    assert.equal(storage.dirty.has('settings'), true);
    storage.flushSync();
    assert.equal(storage.dirty.has('settings'), false);
    await storage.close();
    const restarted = new JsonFileStorage(dir);
    assert.deepEqual(await restarted.get('settings', 'retry'), { value: 'new' });
    await restarted.close();
  });

  it('rolls back a SQLite workflow pointer when version insertion fails', async () => {
    await assertBatchRollback((dir) => new SqliteStorage(path.join(dir, 'batch.db')));
  });
});
