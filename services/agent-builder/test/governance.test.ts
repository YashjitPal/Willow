import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { listen, makeApp, type App } from './helpers.ts';
import { COLLECTIONS } from '../src/storage/index.ts';

let app: App;
let cleanup: () => Promise<void>;
let closeServer: () => Promise<void>;
let baseUrl: string;
let adminToken = '';
let viewerToken = '';
let viewerId = '';

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

before(async () => {
  ({ app, cleanup } = await makeApp());
  ({ baseUrl, close: closeServer } = await listen(app));
});

after(async () => {
  await closeServer();
  await cleanup();
});

describe('governance identities and audit', () => {
  it('bootstraps an admin key and returns its secret exactly once', async () => {
    const created = await request('POST', '/api/v1/admin/api-keys', { name: 'automation admin', role: 'admin' });
    assert.equal(created.status, 200);
    adminToken = created.data.token;
    assert.match(adminToken, /^wab_[a-f0-9]{20}\./);
    assert.equal(created.data.key.secretHash, undefined);
    assert.equal(created.data.key.salt, undefined);

    const listed = await request('GET', '/api/v1/admin/api-keys', undefined, adminToken);
    assert.equal(listed.status, 200);
    assert.equal(listed.data.keys.length, 1);
    assert.equal(JSON.stringify(listed.data).includes(adminToken), false);
    assert.equal(JSON.stringify(listed.data).includes('secretHash'), false);
  });

  it('enforces viewer scope boundaries and audits denials', async () => {
    const created = await request('POST', '/api/v1/admin/api-keys', { name: 'read only', role: 'viewer' }, adminToken);
    assert.equal(created.status, 200);
    viewerToken = created.data.token;
    viewerId = created.data.key.id;

    assert.equal((await request('GET', '/api/v1/workflows', undefined, viewerToken)).status, 200);
    const openapi = await request('GET', '/api/v1/openapi.json', undefined, viewerToken);
    assert.equal(openapi.status, 200);
    assert.equal(openapi.data.openapi, '3.1.0');
    const denied = await request('POST', '/api/v1/workflows', { name: 'forbidden' }, viewerToken);
    assert.equal(denied.status, 403);
    assert.equal(denied.data.error.code, 'forbidden');

    const audit = await request('GET', '/api/v1/admin/audit?limit=100', undefined, adminToken);
    assert.equal(audit.status, 200);
    const event = audit.data.events.find((candidate: any) => candidate.path === '/api/v1/workflows' && candidate.outcome === 'denied');
    assert.ok(event);
    assert.equal(event.actor.apiKeyId, viewerId);
    assert.equal(JSON.stringify(event).includes(viewerToken), false);
  });

  it('does not allow custom scopes to exceed the declared role', async () => {
    const elevatedViewer = await request('POST', '/api/v1/admin/api-keys', {
      name: 'invalid elevated viewer', role: 'viewer', scopes: ['workflow:write'],
    }, adminToken);
    assert.equal(elevatedViewer.status, 400);
    assert.equal(elevatedViewer.data.error.code, 'invalid_api_key');
    assert.match(elevatedViewer.data.error.message, /exceed viewer role/);
  });

  it('isolates delegated API-key administration and audit feeds by workspace', async () => {
    const alpha = await request('POST', '/api/v1/admin/api-keys', { name: 'Alpha workspace admin', role: 'admin', subjectId: 'alpha-admin', workspaceId: 'alpha-space' }, adminToken);
    const beta = await request('POST', '/api/v1/admin/api-keys', { name: 'Beta workspace admin', role: 'admin', subjectId: 'beta-admin', workspaceId: 'beta-space' }, adminToken);
    assert.equal(alpha.status, 200);
    assert.equal(beta.status, 200);
    assert.equal(alpha.data.key.authority, 'workspace');
    assert.equal(beta.data.key.authority, 'workspace');

    const alphaViewer = await request('POST', '/api/v1/admin/api-keys', { name: 'Alpha viewer', role: 'viewer', subjectId: 'alpha-viewer' }, alpha.data.token);
    assert.equal(alphaViewer.status, 200);
    assert.equal(alphaViewer.data.key.workspaceId, 'alpha-space');

    const crossWorkspaceCreate = await request('POST', '/api/v1/admin/api-keys', { name: 'Forbidden beta key', role: 'viewer', workspaceId: 'beta-space' }, alpha.data.token);
    assert.equal(crossWorkspaceCreate.status, 400);
    assert.equal(crossWorkspaceCreate.data.error.code, 'invalid_api_key');

    const alphaKeys = await request('GET', '/api/v1/admin/api-keys', undefined, alpha.data.token);
    assert.equal(alphaKeys.status, 200);
    assert.ok(alphaKeys.data.keys.some((key: any) => key.id === alpha.data.key.id));
    assert.ok(alphaKeys.data.keys.some((key: any) => key.id === alphaViewer.data.key.id));
    assert.equal(alphaKeys.data.keys.some((key: any) => key.id === beta.data.key.id), false);

    const crossWorkspaceRevoke = await request('DELETE', `/api/v1/admin/api-keys/${beta.data.key.id}`, undefined, alpha.data.token);
    assert.equal(crossWorkspaceRevoke.status, 404);
    assert.equal((await request('GET', '/api/v1/workflows', undefined, beta.data.token)).status, 200);

    const alphaAudit = await request('GET', '/api/v1/admin/audit?limit=500', undefined, alpha.data.token);
    assert.equal(alphaAudit.status, 200);
    assert.ok(alphaAudit.data.events.length > 0);
    assert.ok(alphaAudit.data.events.every((event: any) => event.actor.workspaceId === 'alpha-space'));
    assert.equal(alphaAudit.data.events.some((event: any) => event.actor.workspaceId === 'beta-space'), false);

    for (const [method, path] of [
      ['GET', '/api/v1/admin/credential-vault'],
      ['POST', '/api/v1/admin/credential-vault/rotate'],
      ['POST', '/api/v1/admin/credential-vault/retire-unused'],
    ] as const) {
      const denied = await request(method, path, method === 'POST' ? {} : undefined, alpha.data.token);
      assert.equal(denied.status, 403);
      assert.equal(denied.data.error.code, 'forbidden');
    }
  });

  it('separates run metadata access from trace inspection scopes', async () => {
    const workflow = await request('POST', '/api/v1/workflows', { name: 'trace scope boundary' }, adminToken);
    assert.equal(workflow.status, 200);
    const first = await request('POST', `/api/v1/workflows/${workflow.data.workflow.id}/runs`, { input: { input_as_text: 'first' } }, adminToken);
    const second = await request('POST', `/api/v1/workflows/${workflow.data.workflow.id}/runs`, { input: { input_as_text: 'second' } }, adminToken);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);

    const runReader = await request('POST', '/api/v1/admin/api-keys', { name: 'run metadata only', role: 'viewer', scopes: ['run:read'] }, adminToken);
    const traceReader = await request('POST', '/api/v1/admin/api-keys', { name: 'trace inspection only', role: 'viewer', scopes: ['trace:read'] }, adminToken);
    assert.equal(runReader.status, 200);
    assert.equal(traceReader.status, 200);

    const runId = first.data.run.id;
    const otherRunId = second.data.run.id;
    assert.equal((await request('GET', `/api/v1/runs/${runId}`, undefined, runReader.data.token)).status, 200);
    for (const path of [
      `/api/v1/runs/${runId}/trace`,
      `/api/v1/runs/${runId}/spans`,
      `/api/v1/runs/${runId}/compare?against=${otherRunId}`,
    ]) {
      const denied = await request('GET', path, undefined, runReader.data.token);
      assert.equal(denied.status, 403);
      assert.match(denied.data.error.message, /trace:read/);
      assert.equal((await request('GET', path, undefined, traceReader.data.token)).status, 200);
    }
    const metadataDenied = await request('GET', `/api/v1/runs/${runId}`, undefined, traceReader.data.token);
    assert.equal(metadataDenied.status, 403);
    assert.match(metadataDenied.data.error.message, /run:read/);
  });

  it('revokes a managed key immediately', async () => {
    assert.equal((await request('DELETE', `/api/v1/admin/api-keys/${viewerId}`, undefined, adminToken)).status, 200);
    assert.equal((await request('GET', '/api/v1/workflows', undefined, viewerToken)).status, 401);
  });

  it('requires publisher-level permission to delete workflows', async () => {
    const editor = await request('POST', '/api/v1/admin/api-keys', { name: 'workflow editor', role: 'editor' }, adminToken);
    const workflow = await request('POST', '/api/v1/workflows', { name: 'protected deletion' }, adminToken);
    const denied = await request('DELETE', `/api/v1/workflows/${workflow.data.workflow.id}`, undefined, editor.data.token);
    assert.equal(denied.status, 403);
    assert.equal(denied.data.error.code, 'forbidden');
    assert.match(denied.data.error.message, /workflow:delete/);
  });

  it('enforces append-only audit storage', async () => {
    const rows = await app.storage.list(COLLECTIONS.governanceAudit, { limit: 1 });
    assert.ok(rows.length > 0);
    await assert.rejects(() => app.storage.put(COLLECTIONS.governanceAudit, rows[0].id, { overwritten: true }), /append-only/);
    await assert.rejects(() => app.storage.delete(COLLECTIONS.governanceAudit, rows[0].id), /append-only/);
  });
});
