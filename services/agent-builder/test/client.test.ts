import assert from 'node:assert/strict';
import { it } from 'node:test';
import { AgentBuilderApiError, AgentBuilderClient, type PendingApproval, type RunEvent, type RunStatus, type WorkflowCollaborationEvent, type WorkflowCollaborationStreamEvent } from '../client/index.ts';

class FakeRealtimeWebSocket {
  static instances: FakeRealtimeWebSocket[] = [];
  readonly protocol: string;
  readonly url: string;
  readonly protocols: string[];
  readonly sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean?: boolean }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  private closed = false;

  constructor(url: string, protocols: string[]) {
    this.url = url;
    this.protocols = protocols;
    this.protocol = protocols[0] ?? '';
    FakeRealtimeWebSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.({}));
  }

  send(data: string): void { this.sent.push(data); }

  close(code = 1000, reason = ''): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.({ code, reason, wasClean: code === 1000 });
  }

  serverMessage(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  serverClose(code = 1006, reason = 'dropped'): void {
    this.close(code, reason);
  }
}

async function waitForRealtime(predicate: () => boolean, message: string): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 5_000) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function sseResponse(frames: string): Response {
  const encoded = new TextEncoder().encode(frames);
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

it('SDK sends an idempotency key when creating a deployment', async () => {
  let headers: Headers | undefined;
  const fetchImpl = (async (_input, init) => {
    headers = new Headers(init?.headers);
    return new Response(JSON.stringify({ deployment: { id: 'dep_test' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const client = new AgentBuilderClient({ baseUrl: 'http://agent-builder.test', fetch: fetchImpl });

  await client.createDeployment({
    workflowId: 'wf_test',
    name: 'Production',
    environment: 'production',
    activeVersion: 2,
  }, 'deploy-create-123');

  assert.equal(headers?.get('idempotency-key'), 'deploy-create-123');
});

it('SDK sends an idempotency key when cancelling a run', async () => {
  let headers: Headers | undefined;
  const fetchImpl = (async (_input, init) => {
    headers = new Headers(init?.headers);
    return new Response(JSON.stringify({ run: { id: 'run_test', status: 'cancelled' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const client = new AgentBuilderClient({ baseUrl: 'http://agent-builder.test', fetch: fetchImpl });

  await client.cancelRun('run_test', 'chat-secret', 'cancel-once');

  assert.equal(headers?.get('x-chatkit-client-secret'), 'chat-secret');
  assert.equal(headers?.get('idempotency-key'), 'cancel-once');
});

it('SDK preserves structured error details for workflow deletion blockers', async () => {
  const blockers = {
    publishedReferrers: [{ nodeId: 'subflow', workflowId: 'wf_child', version: 2, parentWorkflowId: 'wf_parent', parentVersion: 4 }],
    deploymentIds: ['dep_live'],
    batchIds: ['batch_active'],
    runIds: ['run_active'],
  };
  const fetchImpl = (async () => new Response(JSON.stringify({
    error: { code: 'workflow_in_use', message: 'workflow is in use', details: blockers },
  }), { status: 409, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  const client = new AgentBuilderClient({ baseUrl: 'http://agent-builder.test', fetch: fetchImpl });

  await assert.rejects(
    client.deleteWorkflow('wf_child'),
    (error: unknown) => error instanceof AgentBuilderApiError
      && error.status === 409
      && error.code === 'workflow_in_use'
      && JSON.stringify(error.details) === JSON.stringify(blockers),
  );
});

it('SDK explicitly rejects client tools with reason and retry headers', async () => {
  let body: unknown;
  let headers: Headers | undefined;
  const fetchImpl = (async (_input, init) => {
    body = JSON.parse(String(init?.body));
    headers = new Headers(init?.headers);
    return new Response(JSON.stringify({ run: { id: 'run_test', status: 'running' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const client = new AgentBuilderClient({ baseUrl: 'http://agent-builder.test', fetch: fetchImpl });

  await client.rejectClientTool('run_test', 'approval_test', '  denied by user  ', 'chat-secret', 'reject-once');

  assert.deepEqual(body, { approved: false, reason: 'denied by user' });
  assert.equal(headers?.get('x-chatkit-client-secret'), 'chat-secret');
  assert.equal(headers?.get('idempotency-key'), 'reject-once');
});

it('SDK sends immutable release ids for deployment rollback and preserves the legacy version overload', async () => {
  const bodies: unknown[] = [];
  const fetchImpl = (async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ deployment: { id: 'dep_test' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const client = new AgentBuilderClient({ baseUrl: 'http://agent-builder.test', fetch: fetchImpl });

  await client.rollbackDeployment('dep_test', { expectedRevision: 7, releaseId: 'rel_exact' });
  await client.rollbackDeployment('dep_test', 8, 3);

  assert.deepEqual(bodies, [
    { expectedRevision: 7, releaseId: 'rel_exact' },
    { expectedRevision: 8, version: 3 },
  ]);
});

it('SDK resumes a dropped SSE stream from the last event id exactly once', async () => {
  let calls = 0;
  const requestedUrls: string[] = [];
  const fetchImpl = (async (input, init) => {
    calls++;
    requestedUrls.push(String(input));
    if (calls === 1) {
      return sseResponse(
        'id: 1\nevent: llm.delta\ndata: {"type":"llm.delta","runId":"run_test","nodeId":"a","delta":"first","at":"now"}\n\n',
      );
    }
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers['last-event-id'], '1');
    assert.match(String(input), /[?&]after=1(?:&|$)/);
    return sseResponse(
      'id: 2\nevent: llm.delta\ndata: {"type":"llm.delta","runId":"run_test","nodeId":"b","delta":"second","at":"now"}\n\n' +
      'id: 3\nevent: run.completed\ndata: {"type":"run.completed","runId":"run_test","output":"firstsecond","at":"now"}\n\n' +
      'event: done\ndata: {"status":"completed"}\n\n',
    );
  }) as typeof fetch;

  const client = new AgentBuilderClient({ baseUrl: 'http://agent-builder.test', fetch: fetchImpl });
  const events: RunEvent[] = [];
  const cursors: number[] = [];
  let doneCalls = 0;
  let streamError: Error | undefined;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('stream did not finish')), 5000);
    client.streamRunEvents('run_test', (event) => events.push(event), {
      maxReconnects: 2,
      onEventId: (id) => cursors.push(id),
      onDone: () => {
        doneCalls++;
        clearTimeout(timeout);
        resolve();
      },
      onError: (error) => {
        streamError = error;
        clearTimeout(timeout);
        reject(error);
      },
    });
  });

  assert.equal(calls, 2);
  assert.equal(requestedUrls.length, 2);
  assert.deepEqual(cursors, [1, 2, 3]);
  assert.deepEqual(events.map((event) => event.type), ['llm.delta', 'llm.delta', 'run.completed']);
  assert.deepEqual(events.filter((event): event is Extract<RunEvent, { type: 'llm.delta' }> => event.type === 'llm.delta').map((event) => event.delta), ['first', 'second']);
  assert.equal(doneCalls, 1);
  assert.equal(streamError, undefined);
});

it('SDK reports a clean SSE disconnect after reconnects are exhausted', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return sseResponse('');
  }) as typeof fetch;

  const client = new AgentBuilderClient({ baseUrl: 'http://agent-builder.test', fetch: fetchImpl });
  const error = await new Promise<Error>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('stream failure was not reported')), 5000);
    client.streamRunEvents('run_clean_disconnect', () => undefined, {
      maxReconnects: 1,
      onDone: () => {
        clearTimeout(timeout);
        reject(new Error('non-terminal stream was reported as complete'));
      },
      onError: (reason) => {
        clearTimeout(timeout);
        resolve(reason);
      },
    });
  });

  assert.equal(calls, 2);
  assert.match(error.message, /ended before the run settled/);
});

it('SDK reconnects realtime sessions with a fresh credential and resumes after the last sequence', async () => {
  FakeRealtimeWebSocket.instances = [];
  const requests: Array<{ body: any; headers: Record<string, string> }> = [];
  const fetchImpl = (async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push({ body, headers: init?.headers as Record<string, string> });
    const index = requests.length;
    return new Response(JSON.stringify({
      session: {
        id: `rts_${index}`,
        runId: 'run_realtime',
        createdAt: 'now',
        expiresAt: 'later',
        connectionExpiresAt: 'later',
        capabilities: ['events', 'run.cancel', 'approval.resolve'],
        websocket: {
          url: '/api/v1/realtime',
          protocols: ['willow.realtime.v1', `willow.session.rts_${index}.secret_${index}`],
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const client = new AgentBuilderClient({
    baseUrl: 'https://agent-builder.test',
    fetch: fetchImpl,
    webSocket: FakeRealtimeWebSocket,
  });
  const events: RunEvent[] = [];
  const cursors: number[] = [];
  let doneStatus = '';
  let streamError: Error | undefined;
  let handle!: ReturnType<AgentBuilderClient['streamRunEventsRealtime']>;
  const completed = new Promise<void>((resolve, reject) => {
    handle = client.streamRunEventsRealtime('run_realtime', (event) => events.push(event), {
      replay: false,
      clientSecret: 'chat-secret',
      maxReconnects: 2,
      reconnectDelayMs: 0,
      onEventId: (cursor) => cursors.push(cursor),
      onDone: (status) => { doneStatus = status; resolve(); },
      onError: (error) => { streamError = error; reject(error); },
    });
  });

  await waitForRealtime(() => FakeRealtimeWebSocket.instances.length === 1, 'initial realtime socket was not created');
  const first = FakeRealtimeWebSocket.instances[0];
  assert.equal(first.url, 'wss://agent-builder.test/api/v1/realtime');
  await waitForRealtime(() => handle.connected, 'realtime stream did not report connected');
  assert.equal(handle.send({ type: 'run.cancel', requestId: 'cancel-one' }), true);
  assert.deepEqual(JSON.parse(first.sent[0]), { type: 'run.cancel', requestId: 'cancel-one' });
  first.serverMessage({ type: 'run.event', runId: 'run_realtime', sequence: 1, event: { type: 'llm.delta', runId: 'run_realtime', nodeId: 'a', delta: 'first', at: 'now' } });
  first.serverClose();

  await waitForRealtime(() => FakeRealtimeWebSocket.instances.length === 2, 'reconnected realtime socket was not created');
  const second = FakeRealtimeWebSocket.instances[1];
  second.serverMessage({ type: 'run.event', runId: 'run_realtime', sequence: 1, event: { type: 'llm.delta', runId: 'run_realtime', nodeId: 'a', delta: 'duplicate', at: 'now' } });
  second.serverMessage({ type: 'run.event', runId: 'run_realtime', sequence: 2, event: { type: 'llm.delta', runId: 'run_realtime', nodeId: 'b', delta: 'second', at: 'now' } });
  second.serverMessage({ type: 'session.completed', runId: 'run_realtime', status: 'completed', cursor: 2 });
  await completed;

  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map((request) => request.body.after), [0, 1]);
  assert.deepEqual(requests.map((request) => request.body.replay), [false, true]);
  assert.ok(requests.every((request) => request.headers['x-chatkit-client-secret'] === 'chat-secret'));
  assert.notEqual(first.protocols[1], second.protocols[1]);
  assert.deepEqual(cursors, [1, 2]);
  assert.deepEqual(events.filter((event): event is Extract<RunEvent, { type: 'llm.delta' }> => event.type === 'llm.delta').map((event) => event.delta), ['first', 'second']);
  assert.equal(doneStatus, 'completed');
  assert.equal(streamError, undefined);
});

it('SDK exposes trace comparison and portable export endpoints', async () => {
  const urls: string[] = [];
  const fetchImpl = (async (input) => {
    urls.push(String(input));
    if (String(input).includes('/compare')) return new Response(JSON.stringify({ comparison: { leftRunId: 'run_a', rightRunId: 'run_b' } }), { status: 200 });
    return new Response(JSON.stringify({ export: { kind: 'willow.run-trace', formatVersion: 1, events: [], spans: [], run: { id: 'run_a' } } }), { status: 200 });
  }) as typeof fetch;
  const client = new AgentBuilderClient({ baseUrl: 'http://agent-builder.test', fetch: fetchImpl });
  const comparison = await client.compareRuns('run_a', 'run_b');
  assert.equal(comparison.comparison.rightRunId, 'run_b');
  const exported = await client.exportTrace('run_a');
  assert.equal(exported.export.kind, 'willow.run-trace');
  assert.match(urls[0], /compare\?against=run_b/);
  assert.match(urls[1], /trace\/export/);
});

it('SDK forwards draft revisions and publish idempotency keys', async () => {
  const requests: Array<{ url: string; body?: any; headers?: Record<string, string> }> = [];
  const fetchImpl = (async (input, init) => {
    requests.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: init?.headers as Record<string, string> | undefined,
    });
    return new Response(JSON.stringify({ workflow: { id: 'wf_test', draftRevision: 3 }, validation: { valid: true, errors: [], warnings: [], contracts: [] }, version: { version: 1 } }), { status: 200 });
  }) as typeof fetch;
  const client = new AgentBuilderClient({ baseUrl: 'http://agent-builder.test', fetch: fetchImpl });
  await client.saveDraft('wf_test', { nodes: [], edges: [] }, 2);
  await client.publishWorkflow('wf_test', 'release', 3, 'publish-once');
  assert.equal(requests[0].body.expectedRevision, 2);
  assert.equal(requests[1].body.expectedRevision, 3);
  assert.equal(requests[1].headers?.['idempotency-key'], 'publish-once');
});

it('SDK exposes typed ChatKit credential rotation and revocation', async () => {
  const requests: Array<{ method?: string; url: string; headers?: Record<string, string> }> = [];
  const session = {
    id: 'cks_test',
    workflowId: 'wf_test',
    workflowVersion: 2,
    deployment: {
      selection: 'latest',
      source: 'published',
      requestedVersion: 'latest',
      resolvedVersion: 2,
      resolvedAt: '2026-07-17T00:00:00.000Z',
    },
    user: 'user_test',
    status: 'active',
    expiresAt: '2026-07-17T01:00:00.000Z',
  } as const;
  const fetchImpl = (async (input, init) => {
    requests.push({ method: init?.method, url: String(input), headers: init?.headers as Record<string, string> | undefined });
    if (String(input).endsWith('/rotate')) {
      return new Response(JSON.stringify({ session, client_secret: 'chatkit_token_rotated', expires_at: session.expiresAt }), { status: 200 });
    }
    return new Response(JSON.stringify({ session: String(input).endsWith('/cancel') ? { ...session, status: 'cancelled' } : session }), { status: 200 });
  }) as typeof fetch;
  const client = new AgentBuilderClient({ baseUrl: 'http://agent-builder.test', fetch: fetchImpl });

  const fetched = await client.getChatSession(session.id, 'chatkit_token_current');
  assert.equal(fetched.session.deployment.resolvedVersion, 2);
  const rotated = await client.rotateChatSession(session.id, 'chatkit_token_current');
  assert.equal(rotated.client_secret, 'chatkit_token_rotated');
  const revoked = await client.revokeChatSession(session.id, rotated.client_secret);
  assert.equal(revoked.session.status, 'cancelled');
  await client.cancelChatSession(session.id, rotated.client_secret);

  assert.deepEqual(requests.map((request) => [request.method, request.url.replace('http://agent-builder.test', '')]), [
    ['GET', '/api/v1/chatkit/sessions/cks_test'],
    ['POST', '/api/v1/chatkit/sessions/cks_test/rotate'],
    ['POST', '/api/v1/chatkit/sessions/cks_test/cancel'],
    ['POST', '/api/v1/chatkit/sessions/cks_test/cancel'],
  ]);
  assert.deepEqual(requests.map((request) => request.headers?.['x-chatkit-client-secret']), [
    'chatkit_token_current',
    'chatkit_token_current',
    'chatkit_token_rotated',
    'chatkit_token_rotated',
  ]);
});

it('SDK sends ChatKit attachments with an idempotent turn', async () => {
  let request: { url: string; body?: any; headers?: Record<string, string> } | undefined;
  const fetchImpl = (async (input, init) => {
    request = {
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: init?.headers as Record<string, string> | undefined,
    };
    return new Response(JSON.stringify({ thread: { id: 'th_test', messages: [] }, run: { id: 'run_test' } }), { status: 200 });
  }) as typeof fetch;
  const client = new AgentBuilderClient({ baseUrl: 'http://agent-builder.test', fetch: fetchImpl });
  await client.sendChatMessage('th_test', '', 'chatkit_token_current', 'turn-with-file', [{
    name: 'brief.txt',
    mimeType: 'text/plain',
    contentBase64: 'aGVsbG8=',
    kind: 'document',
    bytes: 5,
  }]);
  assert.equal(request?.url, 'http://agent-builder.test/api/v1/chatkit/threads/th_test/messages');
  assert.equal(request?.headers?.['x-chatkit-client-secret'], 'chatkit_token_current');
  assert.equal(request?.headers?.['idempotency-key'], 'turn-with-file');
  assert.equal(request?.body.text, '');
  assert.equal(request?.body.attachments[0].name, 'brief.txt');
});

it('SDK preserves the ChatKit paused-run lifecycle contract', async () => {
  const requests: Array<{ method?: string; url: string; body?: unknown; headers?: Record<string, string> }> = [];
  const fetchImpl = (async (input, init) => {
    requests.push({
      method: init?.method,
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: init?.headers as Record<string, string> | undefined,
    });
    return new Response(JSON.stringify({
      run: {
        id: 'run_paused',
        status: 'awaiting_approval',
        pendingApproval: {
          id: 'approval_1',
          runId: 'run_paused',
          nodeId: 'tool',
          kind: 'client_tool',
          message: 'Run the client tool',
          toolCall: { tool: 'lookup', arguments: { query: 'status' } },
          createdAt: 'now',
        },
      },
      events: [],
      spans: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const client = new AgentBuilderClient({ baseUrl: 'https://agent-builder.test', fetch: fetchImpl });

  // Keep the lifecycle states and pending approval shape compile-time checked
  // for consumers such as the run-history and ChatKit preview panels.
  const pausedStatuses: RunStatus[] = ['awaiting_approval', 'awaiting_client_tool', 'awaiting_credentials'];
  const pending: PendingApproval = {
    id: 'approval_1',
    runId: 'run_paused',
    nodeId: 'tool',
    kind: 'client_tool',
    message: 'Run the client tool',
    toolCall: { tool: 'lookup', arguments: { query: 'status' } },
    createdAt: 'now',
  };
  assert.deepEqual(pausedStatuses, ['awaiting_approval', 'awaiting_client_tool', 'awaiting_credentials']);
  assert.equal(pending.kind, 'client_tool');

  await client.getRun('run/paused', 'chat-secret');
  await client.getTrace('run/paused', 'chat-secret');
  await client.getTraceSpans('run/paused', 'chat-secret');
  await client.resolveApproval('run/paused', 'approval/1', true, 'chat-secret', 'approval-once');
  await client.submitClientToolResult('run/paused', 'approval/1', { ok: true, value: 42 }, 'chat-secret', 'tool-once');
  await client.resumeRun('run/paused', 'chat-secret');

  assert.deepEqual(requests.map(({ method, url, body, headers }) => ({
    method,
    path: url.replace('https://agent-builder.test', ''),
    body,
    secret: headers?.['x-chatkit-client-secret'],
    idempotency: headers?.['idempotency-key'],
  })), [
    { method: 'GET', path: '/api/v1/runs/run%2Fpaused', body: undefined, secret: 'chat-secret', idempotency: undefined },
    { method: 'GET', path: '/api/v1/runs/run%2Fpaused/trace', body: undefined, secret: 'chat-secret', idempotency: undefined },
    { method: 'GET', path: '/api/v1/runs/run%2Fpaused/spans', body: undefined, secret: 'chat-secret', idempotency: undefined },
    { method: 'POST', path: '/api/v1/runs/run%2Fpaused/approvals/approval%2F1', body: { approved: true }, secret: 'chat-secret', idempotency: 'approval-once' },
    { method: 'POST', path: '/api/v1/runs/run%2Fpaused/approvals/approval%2F1', body: { result: { ok: true, value: 42 } }, secret: 'chat-secret', idempotency: 'tool-once' },
    { method: 'POST', path: '/api/v1/runs/run%2Fpaused/resume', body: undefined, secret: 'chat-secret', idempotency: undefined },
  ]);
});

it('SDK exposes trace retention pin metrics', async () => {
  let request: { method?: string; url: string; body?: any } | undefined;
  const fetchImpl = (async (input, init) => {
    request = {
      method: init?.method,
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    if (init?.method === 'GET') return new Response(JSON.stringify({ enabled: true, maxRuns: 10, maxAgeDays: 30, finishedAt: '2026-07-17T00:00:00.000Z' }), { status: 200 });
    return new Response(JSON.stringify({ enabled: true, maxRuns: 10, maxAgeDays: 30, deleted: 3, protected: 2, candidates: 3, scanned: 5 }), { status: 200 });
  }) as typeof fetch;
  const client = new AgentBuilderClient({ baseUrl: 'http://agent-builder.test', fetch: fetchImpl });
  const result = await client.enforceTraceRetention({ enabled: true, maxRuns: 10, maxAgeDays: 30 });
  assert.deepEqual(result, {
    enabled: true,
    maxRuns: 10,
    maxAgeDays: 30,
    deleted: 3,
    protected: 2,
    candidates: 3,
    scanned: 5,
  });
  assert.deepEqual(request, {
    method: 'POST',
    url: 'http://agent-builder.test/api/v1/traces/retention',
    body: { force: true, dryRun: false, maxRuns: 10, maxAgeDays: 30 },
  });
  const status = await client.getTraceRetentionStatus();
  assert.equal(status.enabled, true);
  assert.equal(status.maxRuns, 10);
  assert.equal(status.finishedAt, '2026-07-17T00:00:00.000Z');
});

it('SDK sends credential inputs without treating masked responses as secrets', async () => {
  const requests: Array<{ url: string; body?: any }> = [];
  const fetchImpl = (async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ url, body });
    if (url.endsWith('/settings/keys')) return new Response(JSON.stringify({ ok: true, providers: { openai: 1 } }), { status: 200 });
    if (url.endsWith('/mcp/servers')) return new Response(JSON.stringify({ server: { id: 'mcp_test', label: 'MCP', auth: { type: 'bearer' } } }), { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const client = new AgentBuilderClient({ baseUrl: 'http://agent-builder.test', fetch: fetchImpl });
  const providerSecret = 'provider-sdk-sentinel';
  const mcpSecret = 'mcp-sdk-sentinel';
  await client.saveStoredKeys({ openai: [providerSecret] });
  const registered = await client.addMcpServer({ label: 'MCP', url: 'https://example.invalid/mcp', authType: 'Access token / API key', token: mcpSecret, connect: false });
  await client.addMcpServer({
    label: 'Basic MCP',
    url: 'https://example.invalid/basic-mcp',
    authType: 'Basic Auth',
    auth: { type: 'basic', username: 'sdk-user', password: 'sdk-password' },
    connect: false,
  });
  assert.equal(registered.server.id, 'mcp_test');
  assert.equal(requests[0].body.openai[0], providerSecret);
  assert.equal(requests[1].body.token, mcpSecret);
  assert.deepEqual(requests[2].body.auth, { type: 'basic', username: 'sdk-user', password: 'sdk-password' });
  assert.doesNotMatch(JSON.stringify(registered), new RegExp(mcpSecret));
});

it('SDK can adopt a newly minted managed API token without rebuilding the client', async () => {
  let authorization: string | undefined;
  const fetchImpl = (async (_input, init) => {
    authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
    return new Response(JSON.stringify({ ok: true, version: 'test' }), { status: 200 });
  }) as typeof fetch;
  const client = new AgentBuilderClient({ baseUrl: 'http://agent-builder.test', fetch: fetchImpl });
  client.setApiToken('wab_managed.rotated-secret');
  await client.health();
  assert.equal(authorization, 'Bearer wab_managed.rotated-secret');
});

it('SDK exposes credential vault status and rotation metadata without key bytes', async () => {
  const requests: Array<{ method?: string; url: string }> = [];
  const fetchImpl = (async (input, init) => {
    const url = String(input);
    requests.push({ method: init?.method, url });
    if (url.endsWith('/credential-vault/rotate')) {
      return new Response(JSON.stringify({ vault: { activeKeyId: 'rotated-key', keyCount: 2, migrated: 3 } }), { status: 200 });
    }
    if (url.endsWith('/credential-vault/retire-unused')) {
      return new Response(JSON.stringify({ vault: { activeKeyId: 'rotated-key', keyCount: 1, retired: ['active-key'] } }), { status: 200 });
    }
    return new Response(JSON.stringify({ vault: { mode: 'local', activeKeyId: 'active-key', keyCount: 1, encryptedRecords: 3, rotation: { targetKeyId: 'target-key', migrated: 1, total: 3 } } }), { status: 200 });
  }) as typeof fetch;
  const client = new AgentBuilderClient({ baseUrl: 'http://agent-builder.test', fetch: fetchImpl });
  const status = await client.getCredentialVaultStatus();
  const rotated = await client.rotateCredentialVault();
  const retired = await client.retireUnusedCredentialVaultKeys();
  assert.equal(status.vault.encryptedRecords, 3);
  assert.equal(status.vault.rotation?.targetKeyId, 'target-key');
  assert.equal(rotated.vault.activeKeyId, 'rotated-key');
  assert.deepEqual(retired.vault.retired, ['active-key']);
  assert.doesNotMatch(JSON.stringify(status), /secret|key_bytes|ciphertext/i);
  assert.doesNotMatch(JSON.stringify(rotated), /secret|key_bytes|ciphertext/i);
  assert.doesNotMatch(JSON.stringify(retired), /secret|key_bytes|ciphertext/i);
  assert.deepEqual(requests, [
    { method: 'GET', url: 'http://agent-builder.test/api/v1/admin/credential-vault' },
    { method: 'POST', url: 'http://agent-builder.test/api/v1/admin/credential-vault/rotate' },
    { method: 'POST', url: 'http://agent-builder.test/api/v1/admin/credential-vault/retire-unused' },
  ]);
});

it('SDK exposes typed workflow review and presence operations', async () => {
  const requests: Array<{ method?: string; url: string; body?: any }> = [];
  const thread = {
    id: 'review_1', workflowId: 'wf/a', workspaceId: 'acme',
    anchor: { type: 'node', nodeId: 'node/1' }, status: 'open', revision: 1, draftRevision: 3,
    messages: [], createdAt: 'now', updatedAt: 'now',
  } as const;
  const presence = {
    workflowId: 'wf/a', workspaceId: 'acme', clientId: 'tab/1',
    collaborator: { subjectId: 'alice', actorId: 'key', role: 'editor' },
    selectedNodeIds: [], lastSeenAt: 'now', expiresAt: 'later',
  } as const;
  const fetchImpl = (async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method: init?.method, url, body });
    if (url.includes('/presence')) return new Response(JSON.stringify(init?.method === 'GET' ? { presence: [presence] } : init?.method === 'DELETE' ? { ok: true } : { presence }), { status: 200 });
    if (init?.method === 'GET') return new Response(JSON.stringify({ threads: [thread] }), { status: 200 });
    if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }), { status: 200 });
    return new Response(JSON.stringify({ thread: { ...thread, revision: body?.expectedRevision ? body.expectedRevision + 1 : 1, status: body?.status ?? 'open' } }), { status: 200 });
  }) as typeof fetch;
  const client = new AgentBuilderClient({ baseUrl: 'http://agent-builder.test', fetch: fetchImpl });

  await client.listWorkflowReviewThreads('wf/a', false);
  await client.createWorkflowReviewThread('wf/a', { body: 'Review this', anchor: { type: 'node', nodeId: 'node/1' }, displayName: 'Alice' });
  await client.replyToWorkflowReviewThread('wf/a', 'review/1', { body: 'Done', expectedRevision: 1 });
  await client.setWorkflowReviewThreadStatus('wf/a', 'review/1', 'resolved', 2);
  await client.deleteWorkflowReviewThread('wf/a', 'review/1', 4);
  await client.listWorkflowPresence('wf/a');
  await client.updateWorkflowPresence('wf/a', { clientId: 'tab/1', cursor: { x: 1, y: 2 }, selectedNodeIds: ['node/1'], ttlSeconds: 45 });
  await client.leaveWorkflowPresence('wf/a', 'tab/1');

  assert.deepEqual(requests.map(({ method, url }) => [method, url.replace('http://agent-builder.test', '')]), [
    ['GET', '/api/v1/workflows/wf%2Fa/comments?includeResolved=false'],
    ['POST', '/api/v1/workflows/wf%2Fa/comments'],
    ['POST', '/api/v1/workflows/wf%2Fa/comments/review%2F1/replies'],
    ['PATCH', '/api/v1/workflows/wf%2Fa/comments/review%2F1'],
    ['DELETE', '/api/v1/workflows/wf%2Fa/comments/review%2F1?expectedRevision=4'],
    ['GET', '/api/v1/workflows/wf%2Fa/presence'],
    ['PUT', '/api/v1/workflows/wf%2Fa/presence'],
    ['DELETE', '/api/v1/workflows/wf%2Fa/presence?clientId=tab%2F1'],
  ]);
  assert.deepEqual(requests[1].body, { body: 'Review this', anchor: { type: 'node', nodeId: 'node/1' }, displayName: 'Alice' });
  assert.equal(requests[2].body.expectedRevision, 1);
  assert.deepEqual(requests[3].body, { status: 'resolved', expectedRevision: 2 });
  assert.equal(requests[6].body.clientId, 'tab/1');
});

it('SDK covers governance, global run search, MCP updates, and vector file listing', async () => {
  const requests: Array<{ method: string; url: string; body?: unknown }> = [];
  const client = new AgentBuilderClient({
    baseUrl: 'https://agent-builder.test',
    fetch: (async (input, init) => {
      requests.push({
        method: String(init?.method),
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });

  await client.listApiKeys();
  await client.createApiKey({ name: 'automation', role: 'editor', scopes: ['run:create'] });
  await client.revokeApiKey('key/one');
  await client.listAuditEvents(25, 50);
  await client.queryRuns({ workflowId: 'wf one', status: 'failed', limit: 10 });
  await client.updateMcpServer('server/one', { label: 'Renamed', transport: 'sse' });
  await client.listVectorStoreFiles('store/one');

  assert.deepEqual(requests, [
    { method: 'GET', url: 'https://agent-builder.test/api/v1/admin/api-keys', body: undefined },
    { method: 'POST', url: 'https://agent-builder.test/api/v1/admin/api-keys', body: { name: 'automation', role: 'editor', scopes: ['run:create'] } },
    { method: 'DELETE', url: 'https://agent-builder.test/api/v1/admin/api-keys/key%2Fone', body: undefined },
    { method: 'GET', url: 'https://agent-builder.test/api/v1/admin/audit?limit=25&offset=50', body: undefined },
    { method: 'GET', url: 'https://agent-builder.test/api/v1/runs?workflowId=wf+one&status=failed&limit=10', body: undefined },
    { method: 'PATCH', url: 'https://agent-builder.test/api/v1/mcp/servers/server%2Fone', body: { label: 'Renamed', transport: 'sse' } },
    { method: 'GET', url: 'https://agent-builder.test/api/v1/vector-stores/store%2Fone/files', body: undefined },
  ]);
});

it('SDK streams typed workflow collaboration snapshots and live events', async () => {
  let request: { url: string; headers?: Record<string, string> } | undefined;
  const fetchImpl = (async (input, init) => {
    request = { url: String(input), headers: init?.headers as Record<string, string> };
    return sseResponse(
      'id: 0\r\nevent: collaboration.snapshot\r\ndata: {"workflowId":"wf_test","threads":[],"presence":[]}\r\n\r\n' +
      'id: 1\r\nevent: presence.updated\r\ndata: {"seq":1,"workflowId":"wf_test","type":"presence.updated","at":"now","presence":{"workflowId":"wf_test","workspaceId":"acme","clientId":"tab","collaborator":{"subjectId":"alice","actorId":"key","role":"editor"},"selectedNodeIds":[],"lastSeenAt":"now","expiresAt":"later"}}\r\n\r\n' +
      'id: 2\r\nevent: review.deleted\r\ndata: {"seq":2,"workflowId":"wf_test","type":"review.deleted","at":"now","threadId":"review_1"}\r\n\r\n',
    );
  }) as typeof fetch;
  const client = new AgentBuilderClient({ baseUrl: 'http://agent-builder.test', apiToken: 'sdk-token', fetch: fetchImpl });
  const events: WorkflowCollaborationStreamEvent[] = [];
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('collaboration stream did not finish')), 3000);
    client.streamWorkflowCollaboration('wf_test', (event) => events.push(event), {
      maxReconnects: 0,
      onError: reject,
    });
    const poll = setInterval(() => {
      if (events.length === 3) {
        clearInterval(poll);
        clearTimeout(timeout);
        resolve();
      }
    }, 5);
  });

  assert.equal(request?.url, 'http://agent-builder.test/api/v1/workflows/wf_test/collaboration/events');
  assert.equal(request?.headers?.authorization, 'Bearer sdk-token');
  assert.equal(request?.headers?.accept, 'text/event-stream');
  assert.deepEqual(events.map((event) => event.type), ['collaboration.snapshot', 'presence.updated', 'review.deleted']);
  assert.deepEqual((events[0] as Extract<WorkflowCollaborationStreamEvent, { type: 'collaboration.snapshot' }>).threads, []);
  assert.equal((events[1] as WorkflowCollaborationEvent).presence?.clientId, 'tab');
  assert.equal((events[2] as WorkflowCollaborationEvent).threadId, 'review_1');
});

it('SDK sends ChatKit authorization for debugger controls', async () => {
  const requests: Array<{ method?: string; url: string; secret?: string }> = [];
  const fetchImpl = (async (input, init) => {
    const headers = init?.headers as Record<string, string> | undefined;
    requests.push({ method: init?.method, url: String(input), secret: headers?.['x-chatkit-client-secret'] });
    return new Response(JSON.stringify({ run: { id: 'run_parent', status: 'running' } }), { status: 200 });
  }) as typeof fetch;
  const client = new AgentBuilderClient({ baseUrl: 'http://agent-builder.test', fetch: fetchImpl });

  await client.stepDebugRun('run/parent', 'chat-secret');
  await client.continueDebugRun('run/parent', 'chat-secret');

  assert.deepEqual(requests, [
    { method: 'POST', url: 'http://agent-builder.test/api/v1/runs/run%2Fparent/debug/step', secret: 'chat-secret' },
    { method: 'POST', url: 'http://agent-builder.test/api/v1/runs/run%2Fparent/debug/continue', secret: 'chat-secret' },
  ]);
});

it('SDK exposes evaluation filters and categorical model-judge verdicts', async () => {
  const requests: Array<{ url: string; body?: any; idempotencyKey?: string }> = [];
  const fetchImpl = (async (input, init) => {
    const headers = init?.headers as Record<string, string> | undefined;
    requests.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      idempotencyKey: headers?.['idempotency-key'],
    });
    return new Response(JSON.stringify({
      run: {
        id: 'evalrun_1', evaluationId: 'eval_1', workflowId: 'wf_1', status: 'completed',
        runIds: ['run_1'], selection: { model: 'gpt-4.1', tool: 'search', from: '2026-07-01T00:00:00Z', to: '2026-07-18T00:00:00Z' },
        totalRuns: 1, completedRuns: 1, score: 1,
        results: [{ runId: 'run_1', status: 'completed', score: 1, results: [{ graderId: 'label', name: 'Quality', passed: true, score: 1, label: 'good', detail: 'classified as good' }] }],
        createdAt: '2026-07-18T00:00:00Z',
      },
    }), { status: 200 });
  }) as typeof fetch;
  const client = new AgentBuilderClient({ baseUrl: 'http://agent-builder.test', fetch: fetchImpl });

  const response = await client.runEvaluation('eval/1', {
    filters: { model: 'gpt-4.1', tool: 'search', from: '2026-07-01T00:00:00Z', to: '2026-07-18T00:00:00Z' },
  }, 'filtered-evaluation');

  assert.deepEqual(requests, [{
    url: 'http://agent-builder.test/api/v1/evaluations/eval%2F1/run',
    body: { filters: { model: 'gpt-4.1', tool: 'search', from: '2026-07-01T00:00:00Z', to: '2026-07-18T00:00:00Z' } },
    idempotencyKey: 'filtered-evaluation',
  }]);
  assert.equal(response.run.selection?.tool, 'search');
  assert.equal(response.run.results[0].results[0].label, 'good');
});

it('SDK keeps workflow secret values write-only across typed operations', async () => {
  const requests: Array<{ method?: string; url: string; body?: any }> = [];
  const secret = {
    id: 'secret_1', name: 'SERVICE_TOKEN', kind: 'secret', scope: 'workflow', scopeId: 'wf/1', workflowId: 'wf/1',
    revision: 2, hasValue: true, maskedValue: '[REDACTED]', createdAt: 'now', updatedAt: 'now',
  } as const;
  const fetchImpl = (async (input, init) => {
    requests.push({ method: init?.method, url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (init?.method === 'GET') return new Response(JSON.stringify({ secrets: [secret] }), { status: 200 });
    if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }), { status: 200 });
    return new Response(JSON.stringify({ secret }), { status: 200 });
  }) as typeof fetch;
  const client = new AgentBuilderClient({ baseUrl: 'http://agent-builder.test', fetch: fetchImpl });
  const listed = await client.listWorkflowSecrets('wf/1');
  await client.createWorkflowSecret('wf/1', { name: 'SERVICE_TOKEN', value: 'create-secret', description: 'Service token' });
  await client.updateWorkflowSecret('wf/1', 'secret/1', { expectedRevision: 2, value: 'rotate-secret' });
  await client.deleteWorkflowSecret('wf/1', 'secret/1', 3);
  await client.listDeploymentSecrets('dep/1');
  await client.createDeploymentSecret('dep/1', { name: 'SERVICE_TOKEN', value: 'deployment-create' });
  await client.updateDeploymentSecret('dep/1', 'secret/2', { expectedRevision: 1, value: 'deployment-rotate' });
  await client.deleteDeploymentSecret('dep/1', 'secret/2', 2);

  assert.equal(listed.secrets[0].maskedValue, '[REDACTED]');
  assert.equal('value' in listed.secrets[0], false);
  assert.deepEqual(requests.map(({ method, url }) => [method, url.replace('http://agent-builder.test', '')]), [
    ['GET', '/api/v1/workflows/wf%2F1/secrets'],
    ['POST', '/api/v1/workflows/wf%2F1/secrets'],
    ['PATCH', '/api/v1/workflows/wf%2F1/secrets/secret%2F1'],
    ['DELETE', '/api/v1/workflows/wf%2F1/secrets/secret%2F1?expectedRevision=3'],
    ['GET', '/api/v1/deployments/dep%2F1/secrets'],
    ['POST', '/api/v1/deployments/dep%2F1/secrets'],
    ['PATCH', '/api/v1/deployments/dep%2F1/secrets/secret%2F2'],
    ['DELETE', '/api/v1/deployments/dep%2F1/secrets/secret%2F2?expectedRevision=2'],
  ]);
  assert.equal(requests[1].body.value, 'create-secret');
  assert.deepEqual(requests[2].body, { expectedRevision: 2, value: 'rotate-secret' });
});
