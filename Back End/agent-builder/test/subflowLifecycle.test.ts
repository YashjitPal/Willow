import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { listen, makeApp, waitForRun, type App } from './helpers.ts';

let app: App;
let cleanup: () => Promise<void>;
let closeServer: () => Promise<void>;
let baseUrl: string;

async function api(method: string, path: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : undefined };
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

before(async () => { ({ app, cleanup } = await makeApp()); ({ baseUrl, close: closeServer } = await listen(app)); });
after(async () => { await closeServer(); await cleanup(); });

describe('subflow lifecycle integrity', () => {
  it('rejects publication when a pinned child version does not exist', async () => {
    const parent = (await api('POST', '/api/v1/workflows', { name: 'Missing child', graph: subflowGraph('wf_missing', 99) })).data.workflow;
    const published = await api('POST', `/api/v1/workflows/${parent.id}/publish`, {});
    assert.equal(published.status, 422);
    assert.equal(published.data.error.code, 'invalid_workflow');
    assert.match(published.data.error.message, /missing published workflow version/);
  });

  it('snapshots dependencies and blocks deletion of referenced children', async () => {
    const child = (await api('POST', '/api/v1/workflows', { name: 'Child' })).data.workflow;
    assert.equal((await api('POST', `/api/v1/workflows/${child.id}/publish`, {})).status, 200);
    const parent = (await api('POST', '/api/v1/workflows', { name: 'Parent', graph: subflowGraph(child.id, 1) })).data.workflow;
    const published = await api('POST', `/api/v1/workflows/${parent.id}/publish`, {});
    assert.deepEqual(published.data.version.dependencies, [{ nodeId: 'call', workflowId: child.id, version: 1 }]);

    const deletion = await api('DELETE', `/api/v1/workflows/${child.id}`);
    assert.equal(deletion.status, 409);
    assert.equal(deletion.data.error.code, 'workflow_in_use');
    assert.deepEqual(deletion.data.error.details.publishedReferrers, [{ nodeId: 'call', workflowId: child.id, version: 1, parentWorkflowId: parent.id, parentVersion: 1 }]);
    assert.equal((await api('GET', `/api/v1/workflows/${child.id}`)).status, 200);
  });

  it('blocks workflow deletion while a deployment is not archived', async () => {
    const workflow = (await api('POST', '/api/v1/workflows', { name: 'Deployed child' })).data.workflow;
    await api('POST', `/api/v1/workflows/${workflow.id}/publish`, {});
    const deployment = (await api('POST', '/api/v1/deployments', { workflowId: workflow.id, environment: 'lifecycle', activeVersion: 1 })).data.deployment;
    const deletion = await api('DELETE', `/api/v1/workflows/${workflow.id}`);
    assert.equal(deletion.status, 409);
    assert.deepEqual(deletion.data.error.details.deploymentIds, [deployment.id]);
  });

  it('blocks workflow deletion while a direct run is active', async () => {
    const workflow = (await api('POST', '/api/v1/workflows', {
      name: 'Running workflow',
      graph: {
        nodes: [
          { id: 's', type: 'start', config: {} },
          { id: 'a', type: 'agent', config: { model: 'mock/delay:1000', instructions: '', tools: [], outputFormat: 'text' } },
          { id: 'e', type: 'end', config: {} },
        ],
        edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
      },
    })).data.workflow;
    await api('POST', `/api/v1/workflows/${workflow.id}/publish`, {});
    const run = await app.engine.createRun({ workflowId: workflow.id, version: 1, input: { input_as_text: 'wait' } });
    await waitForRun(app, run.id, ['running']);

    const blocked = await api('DELETE', `/api/v1/workflows/${workflow.id}`);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.error.code, 'workflow_in_use');
    assert.deepEqual(blocked.data.error.details.runIds, [run.id]);
    assert.equal((await api('GET', `/api/v1/workflows/${workflow.id}`)).status, 200);

    await app.engine.cancelRun(run.id);
    await waitForRun(app, run.id, ['cancelled']);
    assert.equal((await api('DELETE', `/api/v1/workflows/${workflow.id}`)).status, 200);
  });
});
