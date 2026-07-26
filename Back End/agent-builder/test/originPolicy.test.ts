import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { listen, makeApp, type App } from './helpers.ts';

let app: App;
let cleanup: () => Promise<void>;
let closeServer: () => Promise<void>;
let baseUrl = '';

async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
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

describe('ChatKit deployment origin policy', () => {
  it('enforces the origin on every session and run operation', async () => {
    const workflow = await api('POST', '/api/v1/workflows', { name: 'Origin policy' });
    const workflowId = workflow.data.workflow.id as string;
    assert.equal((await api('POST', `/api/v1/workflows/${workflowId}/publish`, {})).status, 200);
    const created = await api('POST', '/api/v1/deployments', {
      workflowId,
      environment: 'origin-policy',
      activeVersion: 1,
      allowedOrigins: ['https://good.example'],
      sessionRateLimitPerMinute: 100,
      maxActiveSessions: 100,
    });
    assert.equal(created.status, 200);
    const deployment = created.data.deployment;
    const minted = await api(
      'POST',
      '/api/v1/chatkit/sessions',
      { workflow: { id: workflowId }, deployment_id: deployment.id },
      { origin: 'https://good.example' },
    );
    assert.equal(minted.status, 200);
    const sessionId = minted.data.session.id as string;
    const secret = minted.data.client_secret as string;
    const bad = { origin: 'https://evil.example', 'x-chatkit-client-secret': secret };
    const sessionPath = `/api/v1/chatkit/sessions/${sessionId}`;

    const sessionOperations: Array<[string, string, unknown?]> = [
      ['GET', sessionPath],
      ['POST', `${sessionPath}/cancel`],
      ['POST', `${sessionPath}/rotate`],
      ['POST', `${sessionPath}/threads`],
      ['GET', `${sessionPath}/threads`],
    ];
    for (const [method, path, body] of sessionOperations) {
      const response = await api(method, path, body, bad);
      assert.equal(response.status, 403, `${method} ${path} should reject a disallowed origin`);
      assert.equal(response.data.error.code, 'origin_not_allowed');
    }

    const thread = await api('POST', `${sessionPath}/threads`, undefined, {
      origin: 'https://good.example',
      'x-chatkit-client-secret': secret,
    });
    assert.equal(thread.status, 200);
    const threadId = thread.data.thread.id as string;
    const threadPath = `/api/v1/chatkit/threads/${threadId}`;
    for (const [method, path, body] of [
      ['GET', threadPath],
      ['POST', `${threadPath}/messages`, { text: 'blocked' }],
    ] as Array<[string, string, unknown?]>) {
      const response = await api(method, path, body, bad);
      assert.equal(response.status, 403, `${method} ${path} should reject a disallowed origin`);
      assert.equal(response.data.error.code, 'origin_not_allowed');
    }

    const sent = await api('POST', `${threadPath}/messages`, { text: 'hello' }, {
      origin: 'https://good.example',
      'x-chatkit-client-secret': secret,
    });
    assert.equal(sent.status, 200);
    const runId = sent.data.run.id as string;
    const runPath = `/api/v1/runs/${runId}`;
    const runOperations: Array<[string, string, unknown?]> = [
      ['GET', runPath],
      ['GET', `${runPath}/trace`],
      ['GET', `${runPath}/trace/export`],
      ['GET', `${runPath}/spans`],
      ['GET', `${runPath}/events`],
      ['GET', `${runPath}/compare?against=${encodeURIComponent(runId)}`],
      ['POST', `${runPath}/cancel`],
      ['POST', `${runPath}/approvals/fake`, { approved: true }],
      ['POST', `${runPath}/debug/continue`],
      ['POST', `${runPath}/resume`],
    ];
    for (const [method, path, body] of runOperations) {
      const response = await api(method, path, body, bad);
      assert.equal(response.status, 403, `${method} ${path} should reject a disallowed origin`);
      assert.equal(response.data.error.code, 'origin_not_allowed');
    }
  });

  it('re-checks a deployment allow-list after a session is minted', async () => {
    const workflow = await api('POST', '/api/v1/workflows', { name: 'Origin policy update' });
    const workflowId = workflow.data.workflow.id as string;
    assert.equal((await api('POST', `/api/v1/workflows/${workflowId}/publish`, {})).status, 200);
    const created = await api('POST', '/api/v1/deployments', {
      workflowId,
      environment: 'origin-policy-update',
      activeVersion: 1,
      allowedOrigins: ['https://old.example'],
      sessionRateLimitPerMinute: 100,
      maxActiveSessions: 100,
    });
    const deployment = created.data.deployment;
    const minted = await api(
      'POST',
      '/api/v1/chatkit/sessions',
      { workflow: { id: workflowId }, deployment_id: deployment.id },
      { origin: 'https://old.example' },
    );
    assert.equal(minted.status, 200);
    const sessionId = minted.data.session.id as string;
    const secret = minted.data.client_secret as string;
    const updated = await api('PATCH', `/api/v1/deployments/${deployment.id}`, {
      expectedRevision: deployment.revision,
      allowedOrigins: ['https://new.example'],
    });
    assert.equal(updated.status, 200);

    const denied = await api('GET', `/api/v1/chatkit/sessions/${sessionId}`, undefined, {
      origin: 'https://old.example',
      'x-chatkit-client-secret': secret,
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.data.error.code, 'origin_not_allowed');
  });
});

