import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { listen, makeApp, waitForRun, type App } from './helpers.ts';
import { COLLECTIONS, type DeploymentRunAdmissionRecord } from '../src/storage/index.ts';
import { PRICING_CATALOG_VERSION } from '../src/services/pricing.ts';

let app: App;
let cleanup: () => Promise<void>;
let closeServer: () => Promise<void>;
let baseUrl: string;
let workflowId = '';
let deployment: any;
let firstSession: any;
let firstSecret = '';
let initialReleaseId = '';

async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : undefined };
}

before(async () => { ({ app, cleanup } = await makeApp()); ({ baseUrl, close: closeServer } = await listen(app)); });
after(async () => { await closeServer(); await cleanup(); });

describe('durable ChatKit deployments', () => {
  it('defaults new deployments to the latest published workflow version', async () => {
    const workflow = await api('POST', '/api/v1/workflows', { name: 'Latest deployment' });
    const latestWorkflowId = workflow.data.workflow.id;
    assert.equal((await api('POST', `/api/v1/workflows/${latestWorkflowId}/publish`, {})).status, 200);
    assert.equal((await api('POST', `/api/v1/workflows/${latestWorkflowId}/publish`, {})).status, 200);

    const latest = await api('POST', '/api/v1/deployments', {
      workflowId: latestWorkflowId,
      environment: 'latest',
    });
    assert.equal(latest.status, 200);
    assert.equal(latest.data.deployment.activeVersion, 2);
    assert.equal((await api('POST', `/api/v1/workflows/${latestWorkflowId}/publish`, {})).status, 200);
    const persisted = await api('GET', `/api/v1/deployments/${latest.data.deployment.id}`);
    assert.equal(persisted.data.deployment.activeVersion, 2);

    const pinned = await api('POST', '/api/v1/deployments', {
      workflowId: latestWorkflowId,
      environment: 'pinned',
      activeVersion: 1,
    });
    assert.equal(pinned.status, 200);
    assert.equal(pinned.data.deployment.activeVersion, 1);

    const invalid = await api('POST', '/api/v1/deployments', {
      workflowId: latestWorkflowId,
      environment: 'invalid',
      activeVersion: 'latest',
    });
    assert.equal(invalid.status, 400);
  });

  it('rejects implicit deployment before a workflow is published', async () => {
    const workflow = await api('POST', '/api/v1/workflows', { name: 'Unpublished deployment' });
    const result = await api('POST', '/api/v1/deployments', {
      workflowId: workflow.data.workflow.id,
      environment: 'production',
    });
    assert.equal(result.status, 409);
    assert.equal(result.data.error.code, 'workflow_not_published');
  });

  it('deduplicates concurrent deployment creation and rejects key reuse with different settings', async () => {
    const workflow = await api('POST', '/api/v1/workflows', { name: 'Idempotent deployment' });
    const idempotentWorkflowId = workflow.data.workflow.id;
    assert.equal((await api('POST', `/api/v1/workflows/${idempotentWorkflowId}/publish`, {})).status, 200);
    const body = { workflowId: idempotentWorkflowId, environment: 'retryable', activeVersion: 1 };
    const headers = { 'idempotency-key': 'deployment-create-retry' };

    const [first, second] = await Promise.all([
      api('POST', '/api/v1/deployments', body, headers),
      api('POST', '/api/v1/deployments', body, headers),
    ]);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(second.data.deployment.id, first.data.deployment.id);
    const matching = (await api('GET', `/api/v1/deployments?workflowId=${idempotentWorkflowId}`)).data.deployments;
    assert.equal(matching.length, 1);

    const conflict = await api('POST', '/api/v1/deployments', { ...body, name: 'Different request' }, headers);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.data.error.code, 'idempotency_conflict');
  });

  it('creates a versioned environment with origin and quota policy', async () => {
    const workflow = await api('POST', '/api/v1/workflows', { name: 'Deployed support' });
    workflowId = workflow.data.workflow.id;
    assert.equal((await api('POST', `/api/v1/workflows/${workflowId}/publish`, {})).status, 200);
    const created = await api('POST', '/api/v1/deployments', { workflowId, name: 'Production', environment: 'production', activeVersion: 1, allowedOrigins: ['https://app.example.com'], sessionRateLimitPerMinute: 1, maxActiveSessions: 2 });
    assert.equal(created.status, 200);
    deployment = created.data.deployment;
    initialReleaseId = deployment.activeReleaseId;
    assert.equal(deployment.activeVersion, 1);
    assert.equal(deployment.revision, 1);
    assert.equal((await api('POST', '/api/v1/deployments', { workflowId, environment: 'production', activeVersion: 1 })).status, 409);
    assert.equal((await api('POST', '/api/v1/deployments', { workflowId, environment: 'badlimits', activeVersion: 1, maxActiveSessions: 'nope' })).status, 400);
  });

  it('enforces allowed origins and mint quotas', async () => {
    const denied = await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: workflowId }, deployment_id: deployment.id }, { origin: 'https://evil.example' });
    assert.equal(denied.status, 403);
    const allowed = await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: workflowId }, deployment_id: deployment.id }, { origin: 'https://app.example.com' });
    assert.equal(allowed.status, 200);
    firstSession = allowed.data.session;
    firstSecret = allowed.data.client_secret;
    assert.equal(firstSession.workflowVersion, 1);
    assert.equal(firstSession.deployment.selection, 'deployment');
    const crossOrigin = await api('POST', `/api/v1/chatkit/sessions/${firstSession.id}/threads`, undefined, { origin: 'https://evil.example', 'x-chatkit-client-secret': allowed.data.client_secret });
    assert.equal(crossOrigin.status, 403);
    const limited = await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: workflowId }, environment: 'production' }, { origin: 'https://app.example.com' });
    assert.equal(limited.status, 429);
  });

  it('rolls forward and back without changing existing sessions', async () => {
    assert.equal((await api('POST', `/api/v1/workflows/${workflowId}/publish`, {})).status, 200);
    const rolled = await api('POST', `/api/v1/deployments/${deployment.id}/rollout`, { version: 2, expectedRevision: deployment.revision });
    assert.equal(rolled.status, 200);
    deployment = rolled.data.deployment;
    const promotedReleaseId = deployment.activeReleaseId;
    assert.equal(deployment.activeVersion, 2);
    assert.deepEqual(deployment.previousVersions, [1]);
    assert.equal(firstSession.workflowVersion, 1);
    const releases = await api('GET', `/api/v1/deployments/${deployment.id}/releases`);
    assert.equal(releases.status, 200);
    assert.equal(releases.data.releases[0].id, promotedReleaseId);
    assert.equal(releases.data.releases[0].previousReleaseId, initialReleaseId);
    await assert.rejects(() => app.storage.put(COLLECTIONS.deploymentReleases, promotedReleaseId, { changed: true }), /append-only/);
    await assert.rejects(() => app.storage.delete(COLLECTIONS.deploymentReleases, promotedReleaseId), /append-only/);

    const oldThread = await api('POST', `/api/v1/chatkit/sessions/${firstSession.id}/threads`, undefined, { origin: 'https://app.example.com', 'x-chatkit-client-secret': firstSecret });
    const oldTurn = await api('POST', `/api/v1/chatkit/threads/${oldThread.data.thread.id}/messages`, { text: 'old release' }, { origin: 'https://app.example.com', 'x-chatkit-client-secret': firstSecret });
    assert.equal(oldTurn.status, 200);
    assert.equal(oldTurn.data.run.deploymentReleaseId, initialReleaseId);
    const persistedOldRun = await api('GET', `/api/v1/runs/${oldTurn.data.run.id}`, undefined, { origin: 'https://app.example.com', 'x-chatkit-client-secret': firstSecret });
    assert.equal(persistedOldRun.data.run.deploymentReleaseId, initialReleaseId);
    const oldSpans = await api('GET', `/api/v1/runs/${oldTurn.data.run.id}/spans`, undefined, { origin: 'https://app.example.com', 'x-chatkit-client-secret': firstSecret });
    assert.equal(oldSpans.data.spans[0].data.deploymentReleaseId, initialReleaseId);
    const oldExport = await api('GET', `/api/v1/runs/${oldTurn.data.run.id}/trace/export`, undefined, { origin: 'https://app.example.com', 'x-chatkit-client-secret': firstSecret });
    assert.equal(oldExport.data.export.run.deploymentReleaseId, initialReleaseId);

    const policy = await api('PATCH', `/api/v1/deployments/${deployment.id}`, { expectedRevision: deployment.revision, sessionRateLimitPerMinute: 10 });
    deployment = policy.data.deployment;
    const newSession = await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: workflowId }, deployment_id: deployment.id }, { origin: 'https://app.example.com' });
    assert.equal(newSession.status, 200);
    assert.equal(newSession.data.session.deploymentReleaseId, promotedReleaseId);
    const newThread = await api('POST', `/api/v1/chatkit/sessions/${newSession.data.session.id}/threads`, undefined, { origin: 'https://app.example.com', 'x-chatkit-client-secret': newSession.data.client_secret });
    const newTurn = await api('POST', `/api/v1/chatkit/threads/${newThread.data.thread.id}/messages`, { text: 'new release' }, { origin: 'https://app.example.com', 'x-chatkit-client-secret': newSession.data.client_secret });
    assert.equal(newTurn.data.run.deploymentReleaseId, promotedReleaseId);

    const staleNoop = await api('POST', `/api/v1/deployments/${deployment.id}/rollout`, { version: 2, expectedRevision: 1 });
    assert.equal(staleNoop.status, 409);

    const stale = await api('POST', `/api/v1/deployments/${deployment.id}/rollout`, { version: 1, expectedRevision: 1 });
    assert.equal(stale.status, 409);
    const rollback = await api('POST', `/api/v1/deployments/${deployment.id}/rollback`, { expectedRevision: deployment.revision, releaseId: initialReleaseId });
    assert.equal(rollback.status, 200);
    deployment = rollback.data.deployment;
    assert.equal(rollback.data.deployment.activeVersion, 1);
    assert.equal(rollback.data.deployment.previousVersions[0], 2);
    assert.notEqual(rollback.data.deployment.activeReleaseId, initialReleaseId);
    const rollbackReleaseId = rollback.data.deployment.activeReleaseId;
    const afterRollback = await api('GET', `/api/v1/deployments/${deployment.id}/releases`);
    assert.equal(afterRollback.data.releases[0].kind, 'rollback');
    assert.equal(afterRollback.data.releases[0].rollbackOfReleaseId, initialReleaseId);
    assert.equal(afterRollback.data.releases[0].previousReleaseId, promotedReleaseId);
    assert.equal(afterRollback.data.releases[0].id, rollbackReleaseId);
    deployment = (await api('PATCH', `/api/v1/deployments/${deployment.id}`, { expectedRevision: deployment.revision, maxActiveSessions: 3 })).data.deployment;
    const afterRollbackSession = await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: workflowId }, deployment_id: deployment.id }, { origin: 'https://app.example.com' });
    assert.equal(afterRollbackSession.status, 200);
    assert.equal(afterRollbackSession.data.session.workflowVersion, 1);
    assert.equal(afterRollbackSession.data.session.deploymentReleaseId, rollbackReleaseId);
    const usage = await api('GET', `/api/v1/deployments/${deployment.id}/usage`);
    assert.equal(usage.status, 200);
    assert.equal(usage.data.usage.totalSessions, 3);
    assert.equal((await api('DELETE', `/api/v1/deployments/${deployment.id}`)).status, 409);
  });

  it('routes deterministic canaries and promotes them with release metrics', async () => {
    const created = await api('POST', '/api/v1/deployments', { workflowId, name: 'Canary', environment: 'canary', activeVersion: 1, sessionRateLimitPerMinute: 100, maxActiveSessions: 100 });
    let canary = created.data.deployment;
    const activeReleaseId = canary.activeReleaseId;

    const zero = await api('POST', `/api/v1/deployments/${canary.id}/stage`, { version: 2, trafficPercent: 0, expectedRevision: canary.revision });
    assert.equal(zero.status, 200);
    canary = zero.data.deployment;
    const zeroSession = await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: workflowId }, deployment_id: canary.id, cohort_key: 'stable-user' });
    assert.equal(zeroSession.data.session.deploymentReleaseId, activeReleaseId);
    assert.equal(zeroSession.data.session.deployment.route, 'active');

    canary = (await api('POST', `/api/v1/deployments/${canary.id}/cancel-stage`, { expectedRevision: canary.revision })).data.deployment;
    const full = await api('POST', `/api/v1/deployments/${canary.id}/stage`, { version: 2, trafficPercent: 100, expectedRevision: canary.revision });
    canary = full.data.deployment;
    const stagedReleaseId = canary.candidateReleaseId;
    const first = await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: workflowId }, deployment_id: canary.id, cohort_key: 'stable-user' });
    const second = await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: workflowId }, deployment_id: canary.id, cohort_key: 'stable-user' });
    assert.equal(first.data.session.deploymentReleaseId, stagedReleaseId);
    assert.equal(second.data.session.deploymentReleaseId, stagedReleaseId);
    assert.equal(first.data.session.deployment.cohortKeyHash, second.data.session.deployment.cohortKeyHash);
    assert.equal(first.data.session.deployment.route, 'candidate');

    const stale = await api('POST', `/api/v1/deployments/${canary.id}/promote`, { expectedRevision: canary.revision - 1 });
    assert.equal(stale.status, 409);
    const promoted = await api('POST', `/api/v1/deployments/${canary.id}/promote`, { expectedRevision: canary.revision });
    assert.equal(promoted.status, 200);
    canary = promoted.data.deployment;
    assert.equal(canary.activeVersion, 2);
    assert.equal(canary.candidateReleaseId, undefined);
    assert.notEqual(canary.activeReleaseId, stagedReleaseId);

    const releases = await api('GET', `/api/v1/deployments/${canary.id}/releases`);
    assert.equal(releases.data.releases[0].kind, 'promotion');
    assert.equal(releases.data.releases[0].promotedFromReleaseId, stagedReleaseId);
    const afterPromotion = await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: workflowId }, deployment_id: canary.id, cohort_key: 'stable-user' });
    assert.equal(afterPromotion.data.session.deploymentReleaseId, canary.activeReleaseId);

    const metrics = await api('GET', `/api/v1/deployments/${canary.id}/release-metrics`);
    assert.equal(metrics.status, 200);
    assert.equal(metrics.data.metrics.find((item: any) => item.releaseId === stagedReleaseId).sessions, 2);
    assert.equal(metrics.data.metrics.find((item: any) => item.releaseId === canary.activeReleaseId).sessions, 1);
    assert.equal(JSON.stringify(canary).includes('cohortSalt'), false);
  });

  it('rejects foreign or non-staged release references at routing and promotion boundaries', async () => {
    const first = (await api('POST', '/api/v1/deployments', {
      workflowId,
      name: 'Release ownership first',
      environment: 'release-ownership-first',
      activeVersion: 1,
    })).data.deployment;
    const second = (await api('POST', '/api/v1/deployments', {
      workflowId,
      name: 'Release ownership second',
      environment: 'release-ownership-second',
      activeVersion: 1,
    })).data.deployment;

    const storedFirst = await app.storage.get<any>(COLLECTIONS.deployments, first.id);
    assert.ok(storedFirst);
    await app.storage.put(COLLECTIONS.deployments, first.id, {
      ...storedFirst,
      activeReleaseId: second.activeReleaseId,
      candidateReleaseId: second.activeReleaseId,
      candidateTrafficPercent: 100,
      cohortSalt: 'foreign-release-test',
    });
    const corrupted = await app.deployments.get(first.id);
    assert.ok(corrupted);

    await assert.rejects(
      () => app.deployments.resolveRelease(corrupted!, 'cohort'),
      /does not belong to deployment/,
    );
    await assert.rejects(
      () => app.deployments.promoteCandidate(first.id, first.revision),
      /does not belong to deployment/,
    );
  });

  it('replays deployment mutations with an idempotency key without creating duplicate releases', async () => {
    const wf = await api('POST', '/api/v1/workflows', { name: 'Idempotent rollout' });
    const id = wf.data.workflow.id;
    assert.equal((await api('POST', `/api/v1/workflows/${id}/publish`, {})).status, 200);
    assert.equal((await api('POST', `/api/v1/workflows/${id}/publish`, {})).status, 200);
    const created = await api('POST', '/api/v1/deployments', { workflowId: id, name: 'idempotent', environment: 'idempotent', activeVersion: 1 });
    const dep = created.data.deployment;
    const body = { version: 2, expectedRevision: dep.revision };
    const headers = { 'idempotency-key': 'rollout-retry-1' };
    const first = await api('POST', `/api/v1/deployments/${dep.id}/rollout`, body, headers);
    const retry = await api('POST', `/api/v1/deployments/${dep.id}/rollout`, body, headers);
    assert.equal(first.status, 200);
    assert.deepEqual(retry.data, first.data);
    const releases = await api('GET', `/api/v1/deployments/${dep.id}/releases`);
    assert.equal(releases.data.releases.length, 2);
  });

  it('does not activate a cancelled canary through rollback history', async () => {
    let canary = (await api('POST', '/api/v1/deployments', {
      workflowId,
      name: 'Cancelled canary rollback',
      environment: 'cancelled-canary-rollback',
      activeVersion: 1,
    })).data.deployment;
    canary = (await api('POST', `/api/v1/deployments/${canary.id}/stage`, {
      version: 2,
      trafficPercent: 10,
      expectedRevision: canary.revision,
    })).data.deployment;
    const stagedReleaseId = canary.candidateReleaseId;
    canary = (await api('POST', `/api/v1/deployments/${canary.id}/cancel-stage`, {
      expectedRevision: canary.revision,
    })).data.deployment;
    const releasesBefore = (await api('GET', `/api/v1/deployments/${canary.id}/releases`)).data.releases;

    const rejected = await api('POST', `/api/v1/deployments/${canary.id}/rollback`, {
      expectedRevision: canary.revision,
      releaseId: stagedReleaseId,
    });

    assert.equal(rejected.status, 409);
    assert.equal(rejected.data.error.code, 'deployment_conflict');
    const unchanged = (await api('GET', `/api/v1/deployments/${canary.id}`)).data.deployment;
    assert.equal(unchanged.revision, canary.revision);
    assert.equal(unchanged.activeVersion, 1);
    const legacyRejected = await api('POST', `/api/v1/deployments/${canary.id}/rollback`, {
      expectedRevision: canary.revision,
      version: 2,
    });
    assert.equal(legacyRejected.status, 404);
    assert.deepEqual((await api('GET', `/api/v1/deployments/${canary.id}/releases`)).data.releases, releasesBefore);
  });

  it('atomically reserves quota and linearizes routing during concurrent mints', async () => {
    const limited = (await api('POST', '/api/v1/deployments', { workflowId, name: 'Limited', environment: 'limited', activeVersion: 1, sessionRateLimitPerMinute: 100, maxActiveSessions: 1 })).data.deployment;
    const burst = await Promise.all(Array.from({ length: 12 }, (_, index) => api('POST', '/api/v1/chatkit/sessions', { workflow: { id: workflowId }, deployment_id: limited.id, cohort_key: `burst-${index}` })));
    assert.equal(burst.filter((response) => response.status === 200).length, 1);
    assert.equal(burst.filter((response) => response.status === 429).length, 11);

    let racing = (await api('POST', '/api/v1/deployments', { workflowId, name: 'Racing', environment: 'racing', activeVersion: 1, sessionRateLimitPerMinute: 100, maxActiveSessions: 100 })).data.deployment;
    const oldRelease = racing.activeReleaseId;
    const results = await Promise.all([
      api('POST', `/api/v1/deployments/${racing.id}/stage`, { version: 2, trafficPercent: 100, expectedRevision: racing.revision }),
      ...Array.from({ length: 16 }, (_, index) => api('POST', '/api/v1/chatkit/sessions', { workflow: { id: workflowId }, deployment_id: racing.id, cohort_key: `race-${index}` })),
    ]);
    const staged = results[0];
    assert.equal(staged.status, 200);
    racing = staged.data.deployment;
    const validReleases = new Set([oldRelease, racing.candidateReleaseId]);
    const sessions = results.slice(1);
    assert.ok(sessions.every((response) => response.status === 200));
    assert.ok(sessions.every((response) => validReleases.has(response.data.session.deploymentReleaseId)));
    assert.equal((await api('GET', `/api/v1/deployments/${racing.id}/usage`)).data.usage.totalSessions, 16);
  });

  it('stops existing session traffic while paused and resumes it after reactivation', async () => {
    let controlled = (await api('POST', '/api/v1/deployments', {
      workflowId,
      name: 'Pause control',
      environment: 'pause-control',
      activeVersion: 1,
      sessionRateLimitPerMinute: 10,
      maxActiveSessions: 10,
    })).data.deployment;
    const minted = await api('POST', '/api/v1/chatkit/sessions', {
      workflow: { id: workflowId },
      deployment_id: controlled.id,
      user: 'pause-control-user',
    });
    const sessionId = minted.data.session.id;
    const headers = { 'x-chatkit-client-secret': minted.data.client_secret };
    const existingThread = await api('POST', `/api/v1/chatkit/sessions/${sessionId}/threads`, undefined, headers);
    assert.equal(existingThread.status, 200);

    controlled = (await api('PATCH', `/api/v1/deployments/${controlled.id}`, {
      expectedRevision: controlled.revision,
      status: 'paused',
    })).data.deployment;

    const blocked = [];
    for (const request of [
      () => api('GET', `/api/v1/chatkit/sessions/${sessionId}`, undefined, headers),
      () => api('POST', `/api/v1/chatkit/sessions/${sessionId}/threads`, undefined, headers),
      () => api('GET', `/api/v1/chatkit/sessions/${sessionId}/threads`, undefined, headers),
      () => api('GET', `/api/v1/chatkit/threads/${existingThread.data.thread.id}`, undefined, headers),
      () => api('POST', `/api/v1/chatkit/threads/${existingThread.data.thread.id}/messages`, { text: 'blocked while paused' }, headers),
      () => api('POST', `/api/v1/chatkit/sessions/${sessionId}/rotate`, undefined, headers),
      () => api('POST', `/api/v1/chatkit/sessions/${sessionId}/cancel`, undefined, headers),
    ]) blocked.push(await request());
    assert.ok(blocked.every((response) => response.status === 409));
    assert.ok(blocked.every((response) => response.data.error.code === 'deployment_unavailable'));

    controlled = (await api('PATCH', `/api/v1/deployments/${controlled.id}`, {
      expectedRevision: controlled.revision,
      status: 'active',
    })).data.deployment;
    assert.equal(controlled.status, 'active');
    assert.equal((await api('GET', `/api/v1/chatkit/sessions/${sessionId}`, undefined, headers)).status, 200);
    const resumed = await api('POST', `/api/v1/chatkit/threads/${existingThread.data.thread.id}/messages`, { text: 'resumed' }, headers);
    assert.equal(resumed.status, 200);
  });

  it('enforces deployment run quotas without double-counting idempotent retries', async () => {
    const invalid = await api('POST', '/api/v1/deployments', {
      workflowId,
      name: 'Invalid run limits',
      environment: 'invalid-run-limits',
      activeVersion: 1,
      maxConcurrentRuns: 0,
    });
    assert.equal(invalid.status, 400);

    const controlled = (await api('POST', '/api/v1/deployments', {
      workflowId,
      name: 'Run controlled',
      environment: 'run-controlled',
      activeVersion: 1,
      sessionRateLimitPerMinute: 10,
      maxActiveSessions: 10,
      maxConcurrentRuns: 1,
      maxRunsPerMinute: 1,
      maxRunsPerDay: 2,
    })).data.deployment;
    assert.equal(controlled.maxConcurrentRuns, 1);
    assert.equal(controlled.maxRunsPerMinute, 1);
    assert.equal(controlled.maxRunsPerDay, 2);

    const session = await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: workflowId }, deployment_id: controlled.id });
    const headers = { 'x-chatkit-client-secret': session.data.client_secret, 'idempotency-key': 'quota-turn-1' };
    const thread = await api('POST', `/api/v1/chatkit/sessions/${session.data.session.id}/threads`, undefined, headers);
    const first = await api('POST', `/api/v1/chatkit/threads/${thread.data.thread.id}/messages`, { text: 'count once' }, headers);
    assert.equal(first.status, 200);
    const retry = await api('POST', `/api/v1/chatkit/threads/${thread.data.thread.id}/messages`, { text: 'count once' }, headers);
    assert.equal(retry.status, 200);
    assert.equal(retry.data.run.id, first.data.run.id);
    await waitForRun(app, first.data.run.id, ['completed', 'failed', 'cancelled']);

    const afterCompletion = await api('GET', `/api/v1/deployments/${controlled.id}/usage`);
    assert.equal(afterCompletion.data.usage.activeRuns, 0);
    assert.equal(afterCompletion.data.usage.runsLastMinute, 1);
    assert.equal(afterCompletion.data.usage.runsToday, 1);
    assert.equal(afterCompletion.data.usage.totalRuns, 1);

    const limited = await api('POST', `/api/v1/chatkit/threads/${thread.data.thread.id}/messages`, { text: 'blocked second run' }, { ...headers, 'idempotency-key': 'quota-turn-2' });
    assert.equal(limited.status, 429);
    assert.equal(limited.data.error.code, 'deployment_limit_exceeded');
    assert.equal((await api('GET', `/api/v1/deployments/${controlled.id}/usage`)).data.usage.totalRuns, 1);
  });

  it('self-heals stale crash reservations when they block a new run', async () => {
    const controlled = (await api('POST', '/api/v1/deployments', {
      workflowId,
      name: 'Crash recovery admission',
      environment: 'crash-recovery-admission',
      activeVersion: 1,
      maxConcurrentRuns: 1,
      maxRunsPerMinute: 10,
      maxRunsPerDay: 10,
    })).data.deployment;
    const staleAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const stale: DeploymentRunAdmissionRecord = {
      id: 'dra_stale_crash_reservation',
      deploymentId: controlled.id,
      workflowId,
      deploymentReleaseId: controlled.activeReleaseId,
      signature: 'stale-crash-signature',
      status: 'reserved',
      createdAt: staleAt,
      reservedTokens: 0,
      reservedEstimatedCostUsd: 0,
    };
    await app.storage.put(COLLECTIONS.deploymentRunAdmissions, stale.id, stale, controlled.id);

    const session = await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: workflowId }, deployment_id: controlled.id });
    const headers = { 'x-chatkit-client-secret': session.data.client_secret };
    const thread = await api('POST', `/api/v1/chatkit/sessions/${session.data.session.id}/threads`, undefined, headers);
    const sent = await api('POST', `/api/v1/chatkit/threads/${thread.data.thread.id}/messages`, { text: 'recover without restart' }, headers);

    assert.equal(sent.status, 200);
    assert.equal(await app.storage.get(COLLECTIONS.deploymentRunAdmissions, stale.id), undefined);
    await waitForRun(app, sent.data.run.id, ['completed', 'failed', 'cancelled']);
  });

  it('reports partial pricing explicitly and rejects unknown budget fields', async () => {
    const workflow = await api('POST', '/api/v1/workflows', {
      name: 'Partial pricing deployment',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'priced', type: 'agent', config: { instructions: 'Echo.', model: 'mock/echo', tools: [], outputFormat: 'text', includeChatHistory: true, writeToConversationHistory: true, continueOnError: false } },
          { id: 'unpriced', type: 'agent', config: { instructions: 'Echo again.', model: 'mock/delay:0', tools: [], outputFormat: 'text', includeChatHistory: true, writeToConversationHistory: true, continueOnError: false } },
          { id: 'e', type: 'end', data: {} },
        ],
        edges: [
          { id: 'sp', source: 's', target: 'priced' },
          { id: 'pu', source: 'priced', target: 'unpriced' },
          { id: 'ue', source: 'unpriced', target: 'e' },
        ],
      },
    });
    const pricedWorkflowId = workflow.data.workflow.id;
    assert.equal((await api('POST', `/api/v1/workflows/${pricedWorkflowId}/publish`, {})).status, 200);
    const unsupported = await api('POST', '/api/v1/deployments', { workflowId: pricedWorkflowId, environment: 'unsupported-budget', activeVersion: 1, tokenBudgetPerDay: 100 });
    assert.equal(unsupported.status, 400);
    assert.equal(unsupported.data.error.code, 'unsupported_deployment_budget');

    let pricedDeployment = (await api('POST', '/api/v1/deployments', { workflowId: pricedWorkflowId, environment: 'pricing-visible', activeVersion: 1 })).data.deployment;
    const patchRejected = await api('PATCH', `/api/v1/deployments/${pricedDeployment.id}`, { expectedRevision: pricedDeployment.revision, costBudgetPerDay: 1 });
    assert.equal(patchRejected.status, 400);
    assert.equal(patchRejected.data.error.code, 'unsupported_deployment_budget');

    const session = await api('POST', '/api/v1/chatkit/sessions', { workflow: { id: pricedWorkflowId }, deployment_id: pricedDeployment.id });
    const headers = { 'x-chatkit-client-secret': session.data.client_secret };
    const thread = await api('POST', `/api/v1/chatkit/sessions/${session.data.session.id}/threads`, undefined, headers);
    const sent = await api('POST', `/api/v1/chatkit/threads/${thread.data.thread.id}/messages`, { text: 'account this traffic' }, headers);
    await waitForRun(app, sent.data.run.id, ['completed', 'failed', 'cancelled']);

    const metrics = await api('GET', `/api/v1/deployments/${pricedDeployment.id}/release-metrics`);
    const release = metrics.data.metrics.find((item: any) => item.releaseId === pricedDeployment.activeReleaseId);
    assert.equal(release.runs, 1);
    assert.ok(release.inputTokens > 0);
    assert.ok(release.outputTokens > 0);
    assert.equal(release.llmCalls, 2);
    assert.equal(release.unpricedLlmCalls, 1);
    assert.equal(release.unpricedModelCalls, 1);
    assert.equal(release.pricingStatus, 'partial');
    assert.deepEqual(release.pricingCatalogVersions, [PRICING_CATALOG_VERSION]);

    const usage = (await api('GET', `/api/v1/deployments/${pricedDeployment.id}/usage`)).data.usage;
    assert.equal(usage.inputTokens, release.inputTokens);
    assert.equal(usage.outputTokens, release.outputTokens);
    assert.equal(usage.unpricedLlmCalls, 1);
    assert.equal(usage.unpricedModelCalls, 1);
    assert.equal(usage.pricingStatus, 'partial');
    assert.deepEqual(usage.pricingCatalogVersions, [PRICING_CATALOG_VERSION]);
  });
});
