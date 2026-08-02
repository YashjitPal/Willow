import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { COLLECTIONS } from '../src/storage/index.ts';
import { listen, makeApp, type App } from './helpers.ts';

let app: App;
let cleanup: () => Promise<void>;
let closeServer: () => Promise<void>;
let baseUrl = '';
let adminToken = '';
let ownerToken = '';
let intruderToken = '';
let defaultToken = '';
let otherWorkspaceAdminToken = '';

async function request(method: string, path: string, body?: unknown, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : undefined };
}

async function createKey(name: string, subjectId: string, workspaceId: string) {
  const response = await request('POST', '/api/v1/admin/api-keys', { name, role: 'publisher', subjectId, workspaceId }, adminToken);
  return response.data.token as string;
}

before(async () => {
  ({ app, cleanup } = await makeApp());
  ({ baseUrl, close: closeServer } = await listen(app));
  adminToken = (await request('POST', '/api/v1/admin/api-keys', { name: 'vector admin', role: 'admin' })).data.token;
  ownerToken = await createKey('vector owner', 'vector-owner', 'vector-space');
  intruderToken = await createKey('vector intruder', 'vector-intruder', 'vector-space');
  defaultToken = await createKey('vector default', 'default', 'default');
  otherWorkspaceAdminToken = (await request('POST', '/api/v1/admin/api-keys', {
    name: 'other vector workspace admin', role: 'admin', subjectId: 'other-admin', workspaceId: 'other-space',
  }, adminToken)).data.token;
});

after(async () => { await closeServer(); await cleanup(); });

describe('vector store ownership', () => {
  it('isolates store and file routes with admin and legacy compatibility', async () => {
    const created = await request('POST', '/api/v1/vector-stores', { name: 'Private knowledge' }, ownerToken);
    assert.equal(created.status, 200);
    const storeId = created.data.store.id;
    assert.deepEqual([created.data.store.ownerId, created.data.store.workspaceId], ['vector-owner', 'vector-space']);
    const upload = await request('POST', `/api/v1/vector-stores/${storeId}/files`, { filename: 'private.txt', content: 'private ownership phrase' }, ownerToken);
    assert.equal(upload.status, 200);
    const fileId = upload.data.file.id;
    assert.equal((await request('GET', `/api/v1/vector-stores/${storeId}`, undefined, intruderToken)).status, 404);
    assert.equal((await request('GET', `/api/v1/vector-stores/${storeId}/files/${fileId}`, undefined, intruderToken)).status, 404);
    assert.equal((await request('POST', `/api/v1/vector-stores/${storeId}/search`, { query: 'private' }, intruderToken)).status, 404);
    assert.equal((await request('DELETE', `/api/v1/vector-stores/${storeId}`, undefined, intruderToken)).status, 404);
    assert.ok(!(await request('GET', '/api/v1/vector-stores', undefined, intruderToken)).data.stores.some((store: any) => store.id === storeId));
    assert.equal((await request('GET', `/api/v1/vector-stores/${storeId}`, undefined, adminToken)).status, 200);
    assert.equal((await request('GET', `/api/v1/vector-stores/${storeId}`, undefined, otherWorkspaceAdminToken)).status, 404);
    assert.equal((await request('GET', '/api/v1/vector-stores', undefined, otherWorkspaceAdminToken)).data.stores.some((store: any) => store.id === storeId), false);

    const legacy = { ...created.data.store, id: 'vs_legacy_owner' };
    delete legacy.ownerId;
    delete legacy.workspaceId;
    await app.storage.put(COLLECTIONS.vectorStores, legacy.id, legacy);
    assert.equal((await request('GET', `/api/v1/vector-stores/${legacy.id}`, undefined, intruderToken)).status, 404);
    const legacyRead = await request('GET', `/api/v1/vector-stores/${legacy.id}`, undefined, defaultToken);
    assert.equal(legacyRead.status, 200);
    assert.deepEqual([legacyRead.data.store.ownerId, legacyRead.data.store.workspaceId], ['default', 'default']);
  });

  it('rejects foreign vector IDs in File Search nodes and agent file_search tools', async () => {
    const store = await request('POST', '/api/v1/vector-stores', { name: 'Owner runtime store' }, ownerToken);
    const storeId = store.data.store.id;
    const nodeWorkflow = await request('POST', '/api/v1/workflows', {
      name: 'Foreign file search node',
      graph: {
        nodes: [{ id: 's', type: 'start', data: {} }, { id: 'f', type: 'fileSearch', config: { vectorStoreIds: [storeId], query: 'secret' } }, { id: 'e', type: 'end', config: { output: 'done' } }],
        edges: [{ id: 'sf', source: 's', target: 'f' }, { id: 'fe', source: 'f', target: 'e' }],
      },
    }, intruderToken);
    const nodeRun = await request('POST', `/api/v1/workflows/${nodeWorkflow.data.workflow.id}/runs`, { input: {} }, intruderToken);
    let nodeDone: any;
    for (let attempt = 0; attempt < 100; attempt++) {
      nodeDone = (await request('GET', `/api/v1/runs/${nodeRun.data.run.id}`, undefined, intruderToken)).data.run;
      if (nodeDone.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(nodeDone.status, 'failed');
    assert.match(nodeDone.error, /vector store .* not found/);

    const agentWorkflow = await request('POST', '/api/v1/workflows', {
      name: 'Foreign agent file search',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'a', type: 'agent', config: { model: 'mock/tool:file_search', instructions: '', tools: [{ kind: 'file_search', vectorStoreIds: [storeId] }] } },
          { id: 'e', type: 'end', config: {} },
        ],
        edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
      },
    }, intruderToken);
    const agentRun = await request('POST', `/api/v1/workflows/${agentWorkflow.data.workflow.id}/runs`, { input: { input_as_text: 'secret' } }, intruderToken);
    let agentDone: any;
    for (let attempt = 0; attempt < 100; attempt++) {
      agentDone = (await request('GET', `/api/v1/runs/${agentRun.data.run.id}`, undefined, intruderToken)).data.run;
      if (['completed', 'failed'].includes(agentDone.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(agentDone.status, 'completed');
    assert.match(String(agentDone.output), /vector store .* not found/);
    assert.doesNotMatch(String(agentDone.output), /private ownership phrase/);
  });
});
