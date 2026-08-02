import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { listen, makeApp, type App } from './helpers.ts';

let app: App;
let cleanup: () => Promise<void>;
let closeServer: () => Promise<void>;
let baseUrl: string;
let workflowId: string;
let nodeIds: string[];

async function api(method: string, path: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : undefined };
}

async function waitForStatus(runId: string, status: string) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const response = await api('GET', `/api/v1/runs/${runId}`);
    if (response.data.run.status === status) return response.data.run;
    if (['failed', 'cancelled', 'completed'].includes(response.data.run.status) && response.data.run.status !== status) throw new Error(`run settled as ${response.data.run.status}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`run did not reach ${status}`);
}

before(async () => {
  ({ app, cleanup } = await makeApp());
  ({ baseUrl, close: closeServer } = await listen(app));
  const created = await api('POST', '/api/v1/workflows', { name: 'Debugger workflow' });
  workflowId = created.data.workflow.id;
  nodeIds = created.data.workflow.draft.nodes.map((node: any) => node.id);
});
after(async () => { await closeServer(); await cleanup(); });

describe('interactive workflow debugger', () => {
  it('pauses before a breakpoint and continues without replaying it', async () => {
    const started = await api('POST', `/api/v1/workflows/${workflowId}/runs`, { input: { input_as_text: 'debug' }, debug: { breakpointNodeIds: [nodeIds[1]] } });
    const paused = await waitForStatus(started.data.run.id, 'awaiting_debug');
    assert.equal(paused.debugPause.nodeId, nodeIds[1]);
    const events = await api('GET', `/api/v1/runs/${paused.id}/trace`);
    assert.equal(events.data.events.some((event: any) => event.type === 'node.started' && event.nodeId === nodeIds[1]), false);
    assert.equal((await api('POST', `/api/v1/runs/${paused.id}/debug/continue`)).status, 200);
    await waitForStatus(paused.id, 'completed');
  });

  it('steps exactly one node and exposes boundary state and outputs', async () => {
    const started = await api('POST', `/api/v1/workflows/${workflowId}/runs`, { input: { input_as_text: 'step' }, debug: { pauseBeforeFirst: true } });
    let paused = await waitForStatus(started.data.run.id, 'awaiting_debug');
    assert.equal(paused.debugPause.nodeId, nodeIds[0]);
    await api('POST', `/api/v1/runs/${paused.id}/debug/step`);
    paused = await waitForStatus(paused.id, 'awaiting_debug');
    assert.equal(paused.debugPause.nodeId, nodeIds[1]);
    assert.equal(paused.debugPause.lastNodeId, nodeIds[0]);
    assert.equal(typeof paused.debugPause.state, 'object');
    assert.equal(typeof paused.debugPause.nodeOutputs, 'object');
    await api('POST', `/api/v1/runs/${paused.id}/debug/step`);
    paused = await waitForStatus(paused.id, 'awaiting_debug');
    assert.equal(paused.debugPause.nodeId, nodeIds[2]);
    await api('POST', `/api/v1/runs/${paused.id}/debug/continue`);
    await waitForStatus(paused.id, 'completed');
  });

  it('cancels a boundary-paused run without executing its node', async () => {
    const started = await api('POST', `/api/v1/workflows/${workflowId}/runs`, { input: {}, debug: { pauseBeforeFirst: true } });
    const paused = await waitForStatus(started.data.run.id, 'awaiting_debug');
    assert.equal((await api('POST', `/api/v1/runs/${paused.id}/cancel`)).status, 200);
    assert.equal((await api('GET', `/api/v1/runs/${paused.id}`)).data.run.status, 'cancelled');
  });

  it('accepts only one concurrent debugger resume command per pause', async () => {
    const started = await api('POST', `/api/v1/workflows/${workflowId}/runs`, { input: {}, debug: { pauseBeforeFirst: true } });
    const paused = await waitForStatus(started.data.run.id, 'awaiting_debug');

    const results = await Promise.allSettled([
      app.engine.resumeDebug(paused.id, 'step'),
      app.engine.resumeDebug(paused.id, 'continue'),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);

    let current = await api('GET', `/api/v1/runs/${paused.id}`);
    for (let attempt = 0; attempt < 300 && !['awaiting_debug', 'completed'].includes(current.data.run.status); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      current = await api('GET', `/api/v1/runs/${paused.id}`);
    }
    const events = await app.engine.pastEvents(paused.id);
    assert.equal(events.filter((event) => event.type === 'debug.resumed').length, 1);
    if (current.data.run.status === 'awaiting_debug') {
      await app.engine.resumeDebug(paused.id, 'continue');
      await waitForStatus(paused.id, 'completed');
    } else {
      assert.equal(current.data.run.status, 'completed');
    }
  });
});
