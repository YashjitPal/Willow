import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { listen, makeApp, type App } from './helpers.ts';

let app: App;
let cleanup: () => Promise<void>;
let baseUrl: string;
let closeServer: () => Promise<void>;

before(async () => {
  ({ app, cleanup } = await makeApp());
  ({ baseUrl, close: closeServer } = await listen(app));
});
after(async () => {
  await closeServer();
  await cleanup();
});

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

describe('API: health & errors', () => {
  it('GET /health', async () => {
    const { status, data } = await api('GET', '/api/v1/health');
    assert.equal(status, 200);
    assert.equal(data.ok, true);
  });

  it('404 for unknown routes, 405 for wrong methods', async () => {
    assert.equal((await api('GET', '/api/v1/nope')).status, 404);
    assert.equal((await api('DELETE', '/api/v1/health')).status, 405);
  });

  it('400 for malformed JSON bodies', async () => {
    const res = await fetch(`${baseUrl}/api/v1/workflows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{nope',
    });
    assert.equal(res.status, 400);
  });
});

describe('API: workflow lifecycle', () => {
  let wfId: string;

  it('creates a workflow with the default canvas graph', async () => {
    const { status, data } = await api('POST', '/api/v1/workflows', { name: 'Support bot' });
    assert.equal(status, 200);
    wfId = data.workflow.id;
    assert.match(wfId, /^wf_/);
    assert.equal(data.workflow.draft.nodes.length, 2);
    assert.equal(data.validation.valid, true);
  });

  it('autosaves a React Flow draft and reports validation', async () => {
    const { status, data } = await api('PUT', `/api/v1/workflows/${wfId}/draft`, {
      graph: {
        nodes: [
          { id: '1', type: 'start', data: { label: 'Start' }, position: { x: 50, y: 125 } },
          { id: '2', type: 'agent', data: { label: 'Helper', instructions: 'help', model: 'mock/echo' } },
          { id: '3', type: 'end', data: { label: 'End' } },
        ],
        edges: [
          { id: 'e1', source: '1', target: '2' },
          { id: 'e2', source: '2', target: '3' },
        ],
      },
    });
    assert.equal(status, 200);
    assert.equal(data.validation.valid, true);
    assert.equal(data.workflow.draft.nodes.length, 3);
  });

  it('lists, renames, publishes, versions', async () => {
    const list = await api('GET', '/api/v1/workflows');
    assert.ok(list.data.workflows.some((w: any) => w.id === wfId));

    const patched = await api('PATCH', `/api/v1/workflows/${wfId}`, { name: 'Support bot v2' });
    assert.equal(patched.data.workflow.name, 'Support bot v2');

    const pub = await api('POST', `/api/v1/workflows/${wfId}/publish`, { notes: 'first' });
    assert.equal(pub.status, 200);
    assert.equal(pub.data.version.version, 1);

    const versions = await api('GET', `/api/v1/workflows/${wfId}/versions`);
    assert.equal(versions.data.versions.length, 1);
    assert.equal(versions.data.versions[0].notes, 'first');
  });

  it('restores a published version into the draft', async () => {
    const changed = await api('PUT', `/api/v1/workflows/${wfId}/draft`, {
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'e', type: 'end', config: { output: 'changed' } },
        ],
        edges: [{ id: 'se', source: 's', target: 'e' }],
      },
    });
    assert.equal(changed.data.workflow.draft.nodes.length, 2);

    const restored = await api('POST', `/api/v1/workflows/${wfId}/versions/1/restore`);
    assert.equal(restored.status, 200);
    assert.equal(restored.data.validation.valid, true);
    assert.equal(restored.data.workflow.draft.nodes.length, 3);
    assert.equal(restored.data.workflow.latestVersion, 1);
  });

  it('refuses to publish an invalid draft', async () => {
    const bad = await api('POST', '/api/v1/workflows', {
      name: 'broken',
      graph: { nodes: [{ id: 'a', type: 'agent', data: {} }], edges: [] }, // no start
    });
    const badId = bad.data.workflow.id;
    const pub = await api('POST', `/api/v1/workflows/${badId}/publish`, {});
    assert.equal(pub.status, 422);
  });

  it('exports TypeScript and Python code', async () => {
    const ts = await api('POST', `/api/v1/workflows/${wfId}/export`, { format: 'typescript' });
    assert.equal(ts.status, 200);
    assert.match(ts.data.code, /new Agent\(/);
    assert.match(ts.data.code, /runWorkflow/);
    const py = await api('POST', `/api/v1/workflows/${wfId}/export`, { format: 'python' });
    assert.match(py.data.code, /Agent\(/);
    assert.match(py.data.code, /async def run_workflow/);
  });

  it('runs the published version over HTTP and streams SSE events', async () => {
    const started = await api('POST', `/api/v1/workflows/${wfId}/runs`, {
      version: 1,
      input: { input_as_text: 'ping' },
    });
    assert.equal(started.status, 200);
    const runId = started.data.run.id;
    assert.match(runId, /^run_/);
    assert.equal(started.data.run.checkpoint, undefined); // opaque field hidden

    // poll until completed
    let run: any;
    for (let i = 0; i < 100; i++) {
      run = (await api('GET', `/api/v1/runs/${runId}`)).data.run;
      if (['completed', 'failed'].includes(run.status)) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.equal(run.status, 'completed', run.error);
    assert.equal(run.output, 'ping');

    // SSE replay of a settled run
    const sse = await fetch(`${baseUrl}/api/v1/runs/${runId}/events`);
    assert.equal(sse.headers.get('content-type'), 'text/event-stream');
    const text = await sse.text();
    assert.match(text, /run\.completed/);
    assert.match(text, /event: done/);

    // trace endpoint
    const trace = await api('GET', `/api/v1/runs/${runId}/trace`);
    assert.ok(trace.data.events.length >= 4);

    // runs list
    const runs = await api('GET', `/api/v1/workflows/${wfId}/runs`);
    assert.ok(runs.data.runs.some((r: any) => r.id === runId));
  });

  it('approval flow over HTTP', async () => {
    const created = await api('POST', '/api/v1/workflows', {
      name: 'approval',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'u', type: 'userApproval', config: { message: 'ok?' } },
          { id: 'y', type: 'end', config: { output: 'YES' } },
          { id: 'n', type: 'end', config: { output: 'NO' } },
        ],
        edges: [
          { id: 'e1', source: 's', target: 'u' },
          { id: 'e2', source: 'u', target: 'y', sourceHandle: 'approved' },
          { id: 'e3', source: 'u', target: 'n', sourceHandle: 'rejected' },
        ],
      },
    });
    const id = created.data.workflow.id;
    const started = await api('POST', `/api/v1/workflows/${id}/runs`, { input: {} });
    const runId = started.data.run.id;

    let run: any;
    for (let i = 0; i < 100; i++) {
      run = (await api('GET', `/api/v1/runs/${runId}`)).data.run;
      if (run.status === 'awaiting_approval') break;
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.equal(run.status, 'awaiting_approval');
    const approvalId = run.pendingApproval.id;

    // wrong approval id -> 409/404 family
    const bad = await api('POST', `/api/v1/runs/${runId}/approvals/appr_bogus`, { approved: true });
    assert.equal(bad.status, 409);

    const ok = await api('POST', `/api/v1/runs/${runId}/approvals/${approvalId}`, { approved: true });
    assert.equal(ok.status, 200);

    for (let i = 0; i < 100; i++) {
      run = (await api('GET', `/api/v1/runs/${runId}`)).data.run;
      if (['completed', 'failed'].includes(run.status)) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.equal(run.output, 'YES');
  });

  it('validates and coerces declared workflow inputs', async () => {
    const created = await api('POST', '/api/v1/workflows', {
      name: 'typed inputs',
      graph: {
        nodes: [
          {
            id: 's',
            type: 'start',
            config: {
              inputVariables: [{ name: 'count', type: 'number' }],
              stateVariables: [{ name: 'enabled', type: 'boolean', initialValue: false }],
            },
          },
          { id: 'e', type: 'end', config: { output: '$cel:workflow.count' } },
        ],
        edges: [{ id: 'se', source: 's', target: 'e' }],
      },
    });
    const id = created.data.workflow.id;

    const started = await api('POST', `/api/v1/workflows/${id}/runs`, {
      input: {
        variables: { count: '4' },
        state_variables: { enabled: 'true' },
      },
    });
    assert.equal(started.status, 200);
    let run: any;
    for (let i = 0; i < 100; i++) {
      run = (await api('GET', `/api/v1/runs/${started.data.run.id}`)).data.run;
      if (['completed', 'failed'].includes(run.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(run.status, 'completed', run.error);
    assert.equal(run.output, 4);
    assert.equal(run.input.variables.count, 4);
    assert.equal(run.state.enabled, true);

    const unknown = await api('POST', `/api/v1/workflows/${id}/runs`, {
      input: { variables: { missing: 'value' } },
    });
    assert.equal(unknown.status, 422);
    assert.match(unknown.data.error.message, /unknown workflow variable 'missing'/);
  });

  it('deletes a workflow', async () => {
    const created = await api('POST', '/api/v1/workflows', { name: 'temp' });
    const id = created.data.workflow.id;
    assert.equal((await api('DELETE', `/api/v1/workflows/${id}`)).status, 200);
    assert.equal((await api('GET', `/api/v1/workflows/${id}`)).status, 404);
  });
});

describe('API: workflow templates and data contracts', () => {
  it('lists templates and creates a validated router template', async () => {
    const templates = await api('GET', '/api/v1/workflow-templates');
    assert.equal(templates.status, 200);
    assert.ok(templates.data.templates.some((t: any) => t.id === 'router'));

    const created = await api('POST', '/api/v1/workflows/from-template', {
      templateId: 'router',
    });
    assert.equal(created.status, 200);
    assert.equal(created.data.validation.valid, true, JSON.stringify(created.data.validation.errors));
    assert.ok(created.data.validation.contracts.some((c: any) => c.nodeType === 'agent'));
    assert.equal(created.data.workflow.name, 'Router and specialists');
  });

  it('returns a useful not-found error for unknown templates', async () => {
    const response = await api('POST', '/api/v1/workflows/from-template', { templateId: 'missing' });
    assert.equal(response.status, 404);
    assert.match(response.data.error.message, /template 'missing'/);
  });
});

describe('API: trace evaluations', () => {
  it('runs deterministic graders against a workflow trace', async () => {
    const created = await api('POST', '/api/v1/workflows', {
      name: 'evaluated',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'a', type: 'agent', data: { label: 'Answer', model: 'mock/echo', instructions: 'Echo the input.' } },
          { id: 'e', type: 'end', data: { label: 'End', config: { output: '{{answer.output_text}}' } } },
        ],
        edges: [
          { id: 'sa', source: 's', target: 'a' },
          { id: 'ae', source: 'a', target: 'e' },
        ],
      },
    });
    const workflowId = created.data.workflow.id;
    const started = await api('POST', `/api/v1/workflows/${workflowId}/runs`, {
      input: { input_as_text: 'evaluation marker' },
    });
    let run: any;
    for (let i = 0; i < 100; i++) {
      run = (await api('GET', `/api/v1/runs/${started.data.run.id}`)).data.run;
      if (['completed', 'failed'].includes(run.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(run.status, 'completed', run.error);

    const definition = await api('POST', `/api/v1/workflows/${workflowId}/evaluations`, {
      name: 'Smoke graders',
      graders: [
        { id: 'status', name: 'Completed', type: 'run_status', expected: 'completed' },
        { id: 'marker', name: 'Contains marker', type: 'contains', expected: 'evaluation marker' },
        { id: 'nodes', name: 'Has node trace', type: 'event_count', eventType: 'node.completed', expected: 1 },
      ],
    });
    assert.equal(definition.status, 200);
    const evaluated = await api('POST', `/api/v1/evaluations/${definition.data.evaluation.id}/run`, {
      runIds: [run.id],
    });
    assert.equal(evaluated.status, 200);
    assert.equal(evaluated.data.run.results[0].score, 1);

    const updated = await api('PATCH', `/api/v1/evaluations/${definition.data.evaluation.id}`, {
      name: 'Updated graders',
      graders: [{ id: 'status', type: 'run_status', expected: 'completed' }],
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.evaluation.name, 'Updated graders');
    assert.equal(updated.data.evaluation.graders.length, 1);

    const history = await api('GET', `/api/v1/evaluations/${definition.data.evaluation.id}/runs`);
    assert.equal(history.status, 200);
    assert.equal(history.data.runs.length, 1);

    const removed = await api('DELETE', `/api/v1/evaluations/${definition.data.evaluation.id}`);
    assert.equal(removed.status, 200);
    const missing = await api('GET', `/api/v1/evaluations/${definition.data.evaluation.id}`);
    assert.equal(missing.status, 404);
  });
});

describe('API: settings & models', () => {
  it('stores and masks provider keys', async () => {
    const put = await api('PUT', '/api/v1/settings/keys', {
      gemini: ['AIzaSyFakeFakeFakeFakeFakeFakeFakeFake'],
    });
    assert.equal(put.status, 200);
    const got = await api('GET', '/api/v1/settings/keys');
    assert.equal(got.data.keys.gemini.length, 1);
    assert.doesNotMatch(got.data.keys.gemini[0], /FakeFakeFakeFake/); // masked
    // clear
    await api('PUT', '/api/v1/settings/keys', { gemini: null });
  });

  it('lists mock models without any key', async () => {
    const { data } = await api('GET', '/api/v1/models?provider=mock');
    assert.ok(data.models.some((m: any) => m.id === 'mock/echo'));
  });
});

describe('API: vector stores', () => {
  let storeId: string;

  it('creates a store (local embedder fallback) and ingests a file', async () => {
    const created = await api('POST', '/api/v1/vector-stores', { name: 'kb' });
    assert.equal(created.status, 200);
    storeId = created.data.store.id;
    assert.match(storeId, /^vs_/);
    assert.equal(created.data.store.embedder, 'local'); // no keys configured

    const file = await api('POST', `/api/v1/vector-stores/${storeId}/files`, {
      filename: 'facts.txt',
      content:
        'The willow tree grows near rivers and lakes. ' +
        'Photosynthesis converts sunlight into chemical energy. ' +
        'The capital of France is Paris.',
    });
    assert.equal(file.status, 200);
    assert.equal(file.data.file.status, 'ready');
    assert.ok(file.data.file.chunkCount >= 1);
  });

  it('searches the store', async () => {
    const res = await api('POST', `/api/v1/vector-stores/${storeId}/search`, {
      query: 'willow tree rivers',
    });
    assert.equal(res.status, 200);
    assert.ok(res.data.results.length >= 1);
    assert.match(res.data.results[0].text, /willow/i);
  });

  it('file search node works inside a workflow', async () => {
    const created = await api('POST', '/api/v1/workflows', {
      name: 'rag',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          {
            id: 'fs',
            type: 'fileSearch',
            name: 'Lookup',
            config: { vectorStoreIds: [storeId], query: '{{workflow.input_as_text}}', maxResults: 2 },
          },
          { id: 'e', type: 'end', config: { output: '{{lookup.results[0].text}}' } },
        ],
        edges: [
          { id: 'e1', source: 's', target: 'fs' },
          { id: 'e2', source: 'fs', target: 'e' },
        ],
      },
    });
    const wfId = created.data.workflow.id;
    const started = await api('POST', `/api/v1/workflows/${wfId}/runs`, {
      input: { input_as_text: 'capital of France' },
    });
    let run: any;
    for (let i = 0; i < 100; i++) {
      run = (await api('GET', `/api/v1/runs/${started.data.run.id}`)).data.run;
      if (['completed', 'failed'].includes(run.status)) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.equal(run.status, 'completed', run.error);
    assert.match(String(run.output), /willow|Paris|Photosynthesis/);
  });

  it('deletes files and stores', async () => {
    const files = await api('GET', `/api/v1/vector-stores/${storeId}/files`);
    const fileId = files.data.files[0].id;
    assert.equal((await api('DELETE', `/api/v1/vector-stores/${storeId}/files/${fileId}`)).status, 200);
    assert.equal((await api('DELETE', `/api/v1/vector-stores/${storeId}`)).status, 200);
    assert.equal((await api('GET', `/api/v1/vector-stores/${storeId}`)).status, 404);
  });
});

describe('API: MCP registry surface', () => {
  it('lists the connector catalog', async () => {
    const { data } = await api('GET', '/api/v1/mcp/connectors');
    const names = data.connectors.map((c: any) => c.name);
    for (const expected of ['Gmail', 'Google Drive', 'Zapier', 'Stripe', 'HubSpot']) {
      assert.ok(names.includes(expected), `missing connector ${expected}`);
    }
  });

  it('registers a custom server without connecting and never leaks the token', async () => {
    const created = await api('POST', '/api/v1/mcp/servers', {
      label: 'my_mcp',
      url: 'https://example.invalid/mcp',
      authType: 'Access token / API key',
      token: 'supersecret_token_value',
      connect: false,
    });
    assert.equal(created.status, 200);
    assert.equal(created.data.server.label, 'my_mcp');
    assert.equal(created.data.server.auth.type, 'bearer');
    assert.equal(JSON.stringify(created.data).includes('supersecret_token_value'), false);

    const list = await api('GET', '/api/v1/mcp/servers');
    assert.equal(JSON.stringify(list.data).includes('supersecret_token_value'), false);

    const del = await api('DELETE', `/api/v1/mcp/servers/${created.data.server.id}`);
    assert.equal(del.status, 200);
  });
});

describe('API: chat sessions', () => {
  it('full ChatKit-style flow: session -> thread -> message -> assistant reply', async () => {
    const created = await api('POST', '/api/v1/workflows', {
      name: 'chatbot',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'a', type: 'agent', config: { instructions: '', model: 'mock/upper', tools: [], outputFormat: 'text', includeChatHistory: true, writeToConversationHistory: true, continueOnError: false } },
        ],
        edges: [{ id: 'e1', source: 's', target: 'a' }],
      },
    });
    const wfId = created.data.workflow.id;

    const session = await api('POST', '/api/v1/chatkit/sessions', {
      workflow: { id: wfId, version: 0 },
      user: 'user_123',
    });
    assert.equal(session.status, 200);
    assert.match(session.data.client_secret, /^chatkit_token_/);
    const sessionId = session.data.session.id;

    const thread = await api('POST', `/api/v1/chatkit/sessions/${sessionId}/threads`);
    assert.equal(thread.status, 200);
    const threadId = thread.data.thread.id;

    const sent = await api('POST', `/api/v1/chatkit/threads/${threadId}/messages`, {
      text: 'hello chat',
    });
    assert.equal(sent.status, 200);
    const runId = sent.data.run.id;

    // wait for the run + thread finalization
    for (let i = 0; i < 150; i++) {
      const run = (await api('GET', `/api/v1/runs/${runId}`)).data.run;
      if (['completed', 'failed'].includes(run.status)) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    let threadAfter: any;
    for (let i = 0; i < 100; i++) {
      threadAfter = (await api('GET', `/api/v1/chatkit/threads/${threadId}`)).data.thread;
      if (threadAfter.messages.length >= 2) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.equal(threadAfter.messages.length, 2);
    assert.equal(threadAfter.messages[0].role, 'user');
    assert.equal(threadAfter.messages[1].role, 'assistant');
    assert.equal(threadAfter.messages[1].content, 'HELLO CHAT');

    // cancel session -> further messages rejected
    await api('POST', `/api/v1/chatkit/sessions/${sessionId}/cancel`);
    const rejected = await api('POST', `/api/v1/chatkit/threads/${threadId}/messages`, { text: 'x' });
    assert.equal(rejected.status, 410);
  });
});
