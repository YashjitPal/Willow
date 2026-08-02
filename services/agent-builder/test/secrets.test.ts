import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { listen, makeApp, waitForRun, type App } from './helpers.ts';

let app: App;
let cleanup: () => Promise<void>;
let closeToolServer: () => Promise<void>;
let baseUrl = '';
let toolUrl = '';
const received: Array<{ authorization?: string; composite?: string; url?: string }> = [];

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
  ({ baseUrl } = await listen(app));
  const server = http.createServer((req, res) => {
    received.push({ authorization: req.headers.authorization, composite: req.headers['x-composite'] as string | undefined, url: req.url });
    if (req.url?.startsWith('/encoded-')) {
      const secret = String(req.headers.authorization ?? '').replace(/^Bearer\s+/, '');
      const lowerHex = (value: string) => value.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase());
      const body = JSON.stringify({
        encodeURI: encodeURI(secret),
        encodeURIComponent: encodeURIComponent(secret),
        lowerHexURI: lowerHex(encodeURI(secret)),
        lowerHexComponent: lowerHex(encodeURIComponent(secret)),
      });
      res.writeHead(req.url.startsWith('/encoded-error') ? 502 : 200, { 'content-type': 'application/json' });
      res.end(body);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, echoed: req.headers.authorization, query: req.url }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('tool server failed to listen');
  toolUrl = `http://127.0.0.1:${address.port}/tool?token={{secrets.QUERY_TOKEN}}`;
  closeToolServer = () => new Promise<void>((resolve) => server.close(() => resolve()));
});

after(async () => {
  await closeToolServer();
  await cleanup();
});

describe('scoped secret variables', () => {
  it('vaults, isolates, resolves, overrides, and redacts HTTP tool secrets', async () => {
    const admin = await request('POST', '/api/v1/admin/api-keys', { name: 'Secret admin', role: 'admin' });
    const owner = await request('POST', '/api/v1/admin/api-keys', { name: 'Secret owner', role: 'publisher', subjectId: 'secret-owner', workspaceId: 'secret-space' }, admin.data.token);
    const intruder = await request('POST', '/api/v1/admin/api-keys', { name: 'Secret intruder', role: 'publisher', subjectId: 'secret-intruder', workspaceId: 'secret-space' }, admin.data.token);
    const workflow = await request('POST', '/api/v1/workflows', {
      name: 'Secret HTTP workflow',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'g', type: 'guardrail', config: { pii: true, moderation: false, jailbreak: false, hallucination: false, onTripwire: 'stop' } },
          { id: 'a', type: 'agent', config: { instructions: 'Use the tool.', model: 'mock/tool:http_secret_tool', tools: [{ kind: 'function', name: 'http_secret_tool', parameters: { type: 'object', properties: {} }, execution: { mode: 'http', url: toolUrl, headers: { Authorization: 'Bearer {{secrets.API_TOKEN}}', 'X-Composite': '{{workflow.input_as_text}}:{{secrets.API_TOKEN}}' } } }], outputFormat: 'text', includeChatHistory: false, writeToConversationHistory: false, continueOnError: false } },
          { id: 'e', type: 'end', data: {} },
          { id: 'blocked', type: 'end', data: {} },
        ],
        edges: [{ id: 'sg', source: 's', target: 'g' }, { id: 'ga', source: 'g', target: 'a', sourceHandle: 'pass' }, { id: 'gb', source: 'g', target: 'blocked', sourceHandle: 'fail' }, { id: 'ae', source: 'a', target: 'e' }],
      },
    }, owner.data.token);
    assert.equal(workflow.status, 200);
    const workflowId = workflow.data.workflow.id as string;

    const apiToken = await request('POST', `/api/v1/workflows/${workflowId}/secrets`, { name: 'api_token', value: 'workflow-secret-value', description: 'Tool token' }, owner.data.token);
    const queryToken = await request('POST', `/api/v1/workflows/${workflowId}/secrets`, { name: 'QUERY_TOKEN', value: 'workflow-query-secret' }, owner.data.token);
    assert.equal(apiToken.status, 200);
    assert.equal(apiToken.data.secret.name, 'API_TOKEN');
    assert.equal(apiToken.data.secret.maskedValue, '[REDACTED]');
    assert.equal(JSON.stringify(apiToken.data).includes('workflow-secret-value'), false);
    const listed = await request('GET', `/api/v1/workflows/${workflowId}/secrets`, undefined, owner.data.token);
    assert.equal(listed.data.secrets.length, 2);
    assert.equal(JSON.stringify(listed.data).includes('workflow-query-secret'), false);
    assert.equal((await request('GET', `/api/v1/workflows/${workflowId}/secrets`, undefined, intruder.data.token)).status, 404);

    const first = await request('POST', `/api/v1/workflows/${workflowId}/runs`, { input: { input_as_text: 'marker' } }, owner.data.token);
    const firstRun = await waitForRun(app, first.data.run.id, ['completed', 'failed']);
    assert.equal(firstRun.status, 'completed');
    assert.equal(received[0].authorization, 'Bearer workflow-secret-value');
    assert.equal(received[0].composite, 'marker:workflow-secret-value');
    assert.match(received[0].url ?? '', /workflow-query-secret/);
    assert.doesNotMatch(JSON.stringify(firstRun), /workflow-secret-value|workflow-query-secret/);
    assert.doesNotMatch(JSON.stringify(await app.engine.pastEvents(firstRun.id)), /workflow-secret-value|workflow-query-secret/);

    assert.equal((await request('POST', `/api/v1/workflows/${workflowId}/publish`, {}, owner.data.token)).status, 200);
    const deployment = await request('POST', '/api/v1/deployments', { workflowId, name: 'Production', environment: 'production', activeVersion: 1 }, owner.data.token);
    assert.equal(deployment.status, 200);
    const deploymentId = deployment.data.deployment.id as string;
    const override = await request('POST', `/api/v1/deployments/${deploymentId}/secrets`, { name: 'API_TOKEN', value: 'deployment-secret-value' }, owner.data.token);
    assert.equal(override.status, 200);
    const deployedRun = await app.engine.createRun({ workflowId, version: 1, deploymentId, ownerId: 'secret-owner', workspaceId: 'secret-space', input: { input_as_text: 'deployed' } });
    const settledDeploymentRun = await waitForRun(app, deployedRun.id, ['completed', 'failed']);
    assert.equal(settledDeploymentRun.status, 'completed');
    assert.equal(received[1].authorization, 'Bearer deployment-secret-value');
    assert.equal(received[1].composite, 'deployed:deployment-secret-value');
    assert.doesNotMatch(JSON.stringify(settledDeploymentRun), /deployment-secret-value/);
    assert.doesNotMatch(JSON.stringify(await app.engine.pastEvents(deployedRun.id)), /deployment-secret-value/);

    const encodedSecret = 'CaseSensitive /+?=\u2603:%Aa';
    const encodedVariants = [
      encodeURI(encodedSecret),
      encodeURIComponent(encodedSecret),
      encodeURI(encodedSecret).replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase()),
      encodeURIComponent(encodedSecret).replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase()),
    ];
    const createEncodedWorkflow = async (suffix: 'success' | 'error') => {
      const created = await request('POST', '/api/v1/workflows', {
        name: `Encoded secret ${suffix}`,
        graph: {
          nodes: [
            { id: 's', type: 'start', data: {} },
            { id: 'a', type: 'agent', config: { instructions: 'Use the tool.', model: 'mock/tool:http_secret_tool', tools: [{ kind: 'function', name: 'http_secret_tool', parameters: { type: 'object', properties: {} }, execution: { mode: 'http', url: toolUrl.replace('/tool?token={{secrets.QUERY_TOKEN}}', `/encoded-${suffix}`), headers: { Authorization: 'Bearer {{secrets.ENCODED_TOKEN}}' } } }], outputFormat: 'text', includeChatHistory: false, writeToConversationHistory: false, continueOnError: false } },
            { id: 'e', type: 'end', data: {} },
          ],
          edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
        },
      }, owner.data.token);
      assert.equal(created.status, 200);
      const id = created.data.workflow.id as string;
      assert.equal((await request('POST', `/api/v1/workflows/${id}/secrets`, { name: 'ENCODED_TOKEN', value: encodedSecret }, owner.data.token)).status, 200);
      return id;
    };
    const successWorkflowId = await createEncodedWorkflow('success');
    const successStart = await request('POST', `/api/v1/workflows/${successWorkflowId}/runs`, { input: { input_as_text: 'encoded success' } }, owner.data.token);
    const successRun = await waitForRun(app, successStart.data.run.id, ['completed', 'failed']);
    assert.equal(successRun.status, 'completed');
    const successSurface = JSON.stringify({ run: successRun, events: await app.engine.pastEvents(successRun.id) });
    for (const variant of encodedVariants) assert.equal(successSurface.includes(variant), false, `encoded secret leaked from success surface: ${variant}`);
    assert.match(successSurface, /\[REDACTED\]/);

    const errorWorkflowId = await createEncodedWorkflow('error');
    const errorStart = await request('POST', `/api/v1/workflows/${errorWorkflowId}/runs`, { input: { input_as_text: 'encoded error' } }, owner.data.token);
    const errorRun = await waitForRun(app, errorStart.data.run.id, ['completed', 'failed']);
    const errorEvents = await app.engine.pastEvents(errorRun.id);
    assert.ok(errorEvents.some((event) => event.type === 'tool.failed'));
    const errorSurface = JSON.stringify({ run: errorRun, events: errorEvents, error: errorRun.error });
    for (const variant of encodedVariants) assert.equal(errorSurface.includes(variant), false, `encoded secret leaked from error surface: ${variant}`);
    assert.match(errorSurface, /\[REDACTED\]/);
    assert.equal((await request('DELETE', `/api/v1/workflows/${successWorkflowId}`, undefined, owner.data.token)).status, 200);
    assert.equal((await request('DELETE', `/api/v1/workflows/${errorWorkflowId}`, undefined, owner.data.token)).status, 200);

    const conflict = await request('PATCH', `/api/v1/workflows/${workflowId}/secrets/${apiToken.data.secret.id}`, { expectedRevision: 99, value: 'new-value' }, owner.data.token);
    assert.equal(conflict.status, 409);
    const updated = await request('PATCH', `/api/v1/workflows/${workflowId}/secrets/${apiToken.data.secret.id}`, { expectedRevision: 1, value: 'updated-workflow-secret' }, owner.data.token);
    assert.equal(updated.data.secret.revision, 2);
    assert.equal(JSON.stringify(updated.data).includes('updated-workflow-secret'), false);
    assert.equal((await request('DELETE', `/api/v1/workflows/${workflowId}/secrets/${queryToken.data.secret.id}?expectedRevision=1`, undefined, owner.data.token)).status, 200);

    const published = await app.storage.get<any>('versions', `${workflowId}@1`);
    assert.match(JSON.stringify(published), /\{\{secrets\.API_TOKEN\}\}/);
    assert.doesNotMatch(JSON.stringify(published), /workflow-secret-value|deployment-secret-value|workflow-query-secret/);
    const vault = await request('GET', '/api/v1/admin/credential-vault', undefined, admin.data.token);
    assert.ok(vault.data.vault.encryptedRecords >= 2);

    assert.equal((await request('DELETE', `/api/v1/deployments/${deploymentId}`, undefined, owner.data.token)).status, 200);
    const archivedSecrets = await app.storage.list<any>('secret_variables', { ref: `deployment:${deploymentId}` });
    assert.equal(archivedSecrets.length, 0);
    const recreateOnArchived = await request('POST', `/api/v1/deployments/${deploymentId}/secrets`, { name: 'LATE_TOKEN', value: 'must-not-persist' }, owner.data.token);
    assert.equal(recreateOnArchived.status, 400);
    assert.match(recreateOnArchived.data.error.message, /archived deployments cannot accept secrets/);
    assert.equal((await app.storage.list<any>('secret_variables', { ref: `deployment:${deploymentId}` })).length, 0);
    assert.equal((await request('DELETE', `/api/v1/workflows/${workflowId}`, undefined, owner.data.token)).status, 200);
    const remainingSecrets = await app.storage.list<any>('secret_variables');
    assert.equal(remainingSecrets.some((row) => row.doc.workflowId === workflowId), false);
  });
});
