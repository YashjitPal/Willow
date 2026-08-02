import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { COLLECTIONS } from '../src/storage/index.ts';
import { listen, makeApp, type App } from './helpers.ts';

let app: App;
let cleanup: () => Promise<void>;
let closeServer: () => Promise<void>;
let baseUrl: string;
let adminToken = '';
let aliceToken = '';
let bobToken = '';
let otherWorkspaceToken = '';
let defaultToken = '';
let acmeAdminToken = '';
let otherAdminToken = '';

async function request(method: string, path: string, body?: unknown, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : undefined };
}

async function createKey(name: string, subjectId: string, workspaceId: string) {
  const created = await request('POST', '/api/v1/admin/api-keys', { name, role: 'publisher', subjectId, workspaceId }, adminToken);
  assert.equal(created.status, 200);
  assert.equal(created.data.key.subjectId, subjectId);
  assert.equal(created.data.key.workspaceId, workspaceId);
  return created.data.token as string;
}

function subflowGraph(workflowId: string, version: number) {
  return {
    nodes: [
      { id: 's', type: 'start', data: {} },
      { id: 'call', type: 'subflow', name: 'Call child', config: { workflowId, version, inputMappings: [], outputMappings: [], onError: 'fail', maxDepth: 8 } },
      { id: 'e', type: 'end', data: {} },
    ],
    edges: [{ id: 'sc', source: 's', target: 'call' }, { id: 'ce', source: 'call', target: 'e' }],
  };
}

before(async () => {
  ({ app, cleanup } = await makeApp());
  ({ baseUrl, close: closeServer } = await listen(app));
  const admin = await request('POST', '/api/v1/admin/api-keys', { name: 'ownership admin', role: 'admin' });
  assert.equal(admin.status, 200);
  adminToken = admin.data.token;
  aliceToken = await createKey('Alice', 'alice', 'acme');
  bobToken = await createKey('Bob', 'bob', 'acme');
  otherWorkspaceToken = await createKey('Alice other workspace', 'alice', 'other');
  defaultToken = await createKey('Default legacy owner', 'default', 'default');
  const acmeAdmin = await request('POST', '/api/v1/admin/api-keys', { name: 'Acme workspace admin', role: 'admin', subjectId: 'acme-admin', workspaceId: 'acme' }, adminToken);
  const otherAdmin = await request('POST', '/api/v1/admin/api-keys', { name: 'Other workspace admin', role: 'admin', subjectId: 'other-admin', workspaceId: 'other' }, adminToken);
  assert.equal(acmeAdmin.status, 200);
  assert.equal(otherAdmin.status, 200);
  acmeAdminToken = acmeAdmin.data.token;
  otherAdminToken = otherAdmin.data.token;
});

after(async () => {
  await closeServer();
  await cleanup();
});

describe('workflow ownership foundation', () => {
  it('isolates workflow list, get, and mutation by subject and workspace with admin bypass', async () => {
    const alice = await request('POST', '/api/v1/workflows', { name: 'Alice workflow' }, aliceToken);
    const bob = await request('POST', '/api/v1/workflows', { name: 'Bob workflow' }, bobToken);
    const other = await request('POST', '/api/v1/workflows', { name: 'Other workspace workflow' }, otherWorkspaceToken);
    assert.equal(alice.status, 200);
    assert.equal(bob.status, 200);
    assert.equal(other.status, 200);
    assert.deepEqual([alice.data.workflow.ownerId, alice.data.workflow.workspaceId], ['alice', 'acme']);

    const aliceList = await request('GET', '/api/v1/workflows', undefined, aliceToken);
    const bobList = await request('GET', '/api/v1/workflows', undefined, bobToken);
    const otherList = await request('GET', '/api/v1/workflows', undefined, otherWorkspaceToken);
    assert.deepEqual(aliceList.data.workflows.map((workflow: any) => workflow.id), [alice.data.workflow.id]);
    assert.deepEqual(bobList.data.workflows.map((workflow: any) => workflow.id), [bob.data.workflow.id]);
    assert.deepEqual(otherList.data.workflows.map((workflow: any) => workflow.id), [other.data.workflow.id]);

    assert.equal((await request('GET', `/api/v1/workflows/${bob.data.workflow.id}`, undefined, aliceToken)).status, 404);
    assert.equal((await request('PATCH', `/api/v1/workflows/${bob.data.workflow.id}`, { name: 'stolen' }, aliceToken)).status, 404);
    assert.equal((await request('DELETE', `/api/v1/workflows/${bob.data.workflow.id}`, undefined, aliceToken)).status, 404);
    assert.equal((await request('GET', `/api/v1/workflows/${alice.data.workflow.id}`, undefined, otherWorkspaceToken)).status, 404);

    const adminList = await request('GET', '/api/v1/workflows', undefined, adminToken);
    assert.ok(adminList.data.workflows.some((workflow: any) => workflow.id === alice.data.workflow.id));
    assert.ok(adminList.data.workflows.some((workflow: any) => workflow.id === bob.data.workflow.id));
    assert.equal((await request('PATCH', `/api/v1/workflows/${alice.data.workflow.id}`, { name: 'Admin renamed' }, adminToken)).status, 200);
  });

  it('limits delegated workspace administrators to workflows in their workspace', async () => {
    const acme = await request('POST', '/api/v1/workflows', { name: 'Acme delegated-admin workflow' }, aliceToken);
    const other = await request('POST', '/api/v1/workflows', { name: 'Other delegated-admin workflow' }, otherWorkspaceToken);
    assert.equal(acme.status, 200);
    assert.equal(other.status, 200);

    const acmeList = await request('GET', '/api/v1/workflows', undefined, acmeAdminToken);
    assert.equal(acmeList.status, 200);
    assert.ok(acmeList.data.workflows.some((workflow: any) => workflow.id === acme.data.workflow.id));
    assert.ok(!acmeList.data.workflows.some((workflow: any) => workflow.id === other.data.workflow.id));
    assert.equal((await request('GET', `/api/v1/workflows/${acme.data.workflow.id}`, undefined, acmeAdminToken)).status, 200);
    assert.equal((await request('PATCH', `/api/v1/workflows/${acme.data.workflow.id}`, { name: 'Managed in workspace' }, acmeAdminToken)).status, 200);

    assert.equal((await request('GET', `/api/v1/workflows/${acme.data.workflow.id}`, undefined, otherAdminToken)).status, 404);
    assert.equal((await request('PATCH', `/api/v1/workflows/${acme.data.workflow.id}`, { name: 'Cross-workspace takeover' }, otherAdminToken)).status, 404);
    assert.equal((await request('POST', `/api/v1/workflows/${acme.data.workflow.id}/publish`, {}, otherAdminToken)).status, 404);
    assert.equal((await request('DELETE', `/api/v1/workflows/${acme.data.workflow.id}`, undefined, otherAdminToken)).status, 404);

    const platformRead = await request('GET', `/api/v1/workflows/${acme.data.workflow.id}`, undefined, adminToken);
    assert.equal(platformRead.status, 200);
  });

  it('maps legacy workflows to the default owner and persists metadata on mutation', async () => {
    const seeded = await app.workflows.create({ name: 'Legacy seed' });
    const legacy = structuredClone(seeded.workflow) as any;
    legacy.id = 'wf_legacy_ownership';
    legacy.name = 'Legacy workflow';
    delete legacy.ownerId;
    delete legacy.workspaceId;
    await app.storage.put(COLLECTIONS.workflows, legacy.id, legacy);

    assert.equal((await request('GET', `/api/v1/workflows/${legacy.id}`, undefined, aliceToken)).status, 404);
    const accessible = await request('GET', `/api/v1/workflows/${legacy.id}`, undefined, defaultToken);
    assert.equal(accessible.status, 200);
    assert.deepEqual([accessible.data.workflow.ownerId, accessible.data.workflow.workspaceId], ['default', 'default']);
    assert.equal((await request('PATCH', `/api/v1/workflows/${legacy.id}`, { name: 'Migrated legacy' }, defaultToken)).status, 200);
    const persisted = await app.storage.get<any>(COLLECTIONS.workflows, legacy.id);
    assert.deepEqual([persisted?.ownerId, persisted?.workspaceId], ['default', 'default']);
  });

  it('rejects published subflows that cross owner boundaries', async () => {
    const child = await request('POST', '/api/v1/workflows', { name: 'Alice child' }, aliceToken);
    assert.equal((await request('POST', `/api/v1/workflows/${child.data.workflow.id}/publish`, {}, aliceToken)).status, 200);
    const parent = await request('POST', '/api/v1/workflows', { name: 'Bob parent', graph: subflowGraph(child.data.workflow.id, 1) }, bobToken);
    const published = await request('POST', `/api/v1/workflows/${parent.data.workflow.id}/publish`, {}, bobToken);
    assert.equal(published.status, 422);
    assert.equal(published.data.error.code, 'invalid_workflow');
    assert.match(published.data.error.message, /another subject or workspace/);
  });

  it('inherits workflow ownership onto runs and protects direct run and trace routes', async () => {
    const created = await request('POST', '/api/v1/workflows', { name: 'Alice run owner' }, aliceToken);
    assert.equal(created.status, 200);
    const workflowId = created.data.workflow.id;
    assert.equal((await request('POST', `/api/v1/workflows/${workflowId}/publish`, {}, aliceToken)).status, 200);
    const started = await request('POST', `/api/v1/workflows/${workflowId}/runs`, { version: 1, input: { input_as_text: 'ownership' } }, aliceToken);
    assert.equal(started.status, 200);
    const runId = started.data.run.id;
    assert.deepEqual([started.data.run.ownerId, started.data.run.workspaceId], ['alice', 'acme']);
    assert.equal((await request('GET', `/api/v1/runs/${runId}`, undefined, bobToken)).status, 404);
    assert.equal((await request('GET', `/api/v1/runs/${runId}/trace`, undefined, bobToken)).status, 404);
    assert.equal((await request('POST', `/api/v1/runs/${runId}/cancel`, {}, bobToken)).status, 404);
    assert.equal((await request('GET', `/api/v1/runs/${runId}`, undefined, acmeAdminToken)).status, 200);
    assert.equal((await request('GET', `/api/v1/runs/${runId}`, undefined, otherAdminToken)).status, 404);
    assert.equal((await request('GET', `/api/v1/runs/${runId}/trace`, undefined, otherAdminToken)).status, 404);
    assert.equal((await request('GET', `/api/v1/runs/${runId}`, undefined, adminToken)).status, 200);
    const acmeRuns = await request('GET', `/api/v1/workflows/${workflowId}/runs`, undefined, acmeAdminToken);
    assert.equal(acmeRuns.status, 200);
    assert.ok(acmeRuns.data.runs.some((run: any) => run.id === runId));
    const otherWorkspaceRuns = await request('GET', `/api/v1/workflows/${workflowId}/runs`, undefined, otherAdminToken);
    assert.equal(otherWorkspaceRuns.status, 404);
    const bobRuns = await request('GET', '/api/v1/runs', undefined, bobToken);
    assert.equal(bobRuns.status, 200);
    assert.ok(!bobRuns.data.runs.some((run: any) => run.id === runId));
  });

  it('inherits workflow ownership onto deployments and protects direct deployment controls', async () => {
    const created = await request('POST', '/api/v1/workflows', { name: 'Alice deployment owner' }, aliceToken);
    const workflowId = created.data.workflow.id;
    assert.equal((await request('POST', `/api/v1/workflows/${workflowId}/publish`, {}, aliceToken)).status, 200);
    const deployment = await request('POST', '/api/v1/deployments', { workflowId, environment: 'prod', activeVersion: 1 }, aliceToken);
    assert.equal(deployment.status, 200);
    const deploymentId = deployment.data.deployment.id;
    assert.deepEqual([deployment.data.deployment.ownerId, deployment.data.deployment.workspaceId], ['alice', 'acme']);
    assert.equal((await request('GET', `/api/v1/deployments/${deploymentId}`, undefined, bobToken)).status, 404);
    assert.equal((await request('GET', `/api/v1/deployments/${deploymentId}/usage`, undefined, bobToken)).status, 404);
    assert.equal((await request('PATCH', `/api/v1/deployments/${deploymentId}`, { expectedRevision: 1, name: 'stolen' }, bobToken)).status, 404);
    const bobDeployments = await request('GET', '/api/v1/deployments', undefined, bobToken);
    assert.equal(bobDeployments.status, 200);
    assert.ok(!bobDeployments.data.deployments.some((item: any) => item.id === deploymentId));
    assert.equal((await request('GET', `/api/v1/deployments/${deploymentId}`, undefined, acmeAdminToken)).status, 200);
    assert.equal((await request('GET', `/api/v1/deployments/${deploymentId}`, undefined, otherAdminToken)).status, 404);
    assert.equal((await request('GET', '/api/v1/deployments', undefined, otherAdminToken)).data.deployments.some((item: any) => item.id === deploymentId), false);
    assert.equal((await request('GET', `/api/v1/deployments/${deploymentId}`, undefined, adminToken)).status, 200);
  });
});
