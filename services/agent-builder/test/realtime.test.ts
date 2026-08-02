import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';
import { RealtimeService } from '../src/services/realtime.ts';
import type { AuthPrincipal } from '../src/services/governance.ts';
import { listen, makeApp, type App } from './helpers.ts';

let app: App;
let cleanup: () => Promise<void>;
let baseUrl = '';
let adminToken = '';
let ownerToken = '';
let intruderToken = '';
let ownerViewerToken = '';

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

async function createKey(name: string, subjectId: string, role = 'publisher') {
  const result = await request('POST', '/api/v1/admin/api-keys', {
    name,
    role,
    subjectId,
    workspaceId: 'realtime-space',
  }, adminToken);
  assert.equal(result.status, 200);
  return result.data.token as string;
}

function connect(session: any): {
  socket: WebSocket;
  opened: Promise<void>;
  closed: Promise<{ code: number; reason: string }>;
  messages: any[];
} {
  const url = `${baseUrl.replace(/^http/, 'ws')}${session.websocket.url}`;
  const socket = new WebSocket(url, session.websocket.protocols);
  const messages: any[] = [];
  socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
  const opened = new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  return { socket, opened, closed, messages };
}

async function waitForMessage(messages: any[], type: string, timeoutMs = 5_000): Promise<any> {
  const started = Date.now();
  for (;;) {
    const message = messages.find((candidate) => candidate.type === type);
    if (message) return message;
    if (Date.now() - started > timeoutMs) throw new Error(`realtime message '${type}' was not received`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function rejectedUpgradeStatus(session: any, origin?: string): Promise<number> {
  const url = `${baseUrl.replace(/^http/, 'ws')}${session.websocket.url}`;
  return new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(url, session.websocket.protocols, origin ? { origin } : undefined);
    socket.once('unexpected-response', (_request, response) => {
      resolve(response.statusCode ?? 0);
      response.resume();
    });
    socket.once('open', () => {
      socket.close();
      reject(new Error('reused realtime credential unexpectedly connected'));
    });
    socket.once('error', () => undefined);
  });
}

before(async () => {
  ({ app, cleanup } = await makeApp());
  ({ baseUrl } = await listen(app));
  const admin = await request('POST', '/api/v1/admin/api-keys', { name: 'Realtime admin', role: 'admin' });
  assert.equal(admin.status, 200);
  adminToken = admin.data.token;
  ownerToken = await createKey('Realtime owner', 'realtime-owner');
  intruderToken = await createKey('Realtime intruder', 'realtime-intruder');
  ownerViewerToken = await createKey('Realtime owner viewer', 'realtime-owner', 'viewer');
});

after(async () => {
  await cleanup();
});

describe('realtime run sessions', () => {
  it('leaves unrelated WebSocket upgrades for other host listeners', async () => {
    const engine = {
      getRun: async () => undefined,
      subscribe: () => () => undefined,
    };
    const realtime = new RealtimeService(engine as never, ['*']);
    const server = http.createServer();
    const socketWrites: unknown[][] = [];
    const socket = {
      end: (...args: unknown[]) => { socketWrites.push(args); },
    };
    let hostReceivedUpgrade = false;

    realtime.attach(server);
    server.on('upgrade', () => { hostReceivedUpgrade = true; });
    server.emit('upgrade', {
      url: '/vite-hmr?token=development',
      headers: { host: 'localhost:3000' },
    }, socket, Buffer.alloc(0));

    assert.equal(hostReceivedUpgrade, true);
    assert.deepEqual(socketWrites, []);
    await realtime.close();
  });

  it('does not retain subscriptions or host upgrade listeners when a connection closes during lookup', async () => {
    let finishLookup!: (run: undefined) => void;
    let subscriptions = 0;
    let unsubscriptions = 0;
    const delayedRun = new Promise<undefined>((resolve) => { finishLookup = resolve; });
    const engine = {
      getRun: () => delayedRun,
      subscribe: () => {
        subscriptions += 1;
        return () => { unsubscriptions += 1; };
      },
    };
    const realtime = new RealtimeService(engine as never, ['*']);
    const server = http.createServer();
    const originalUpgradeListeners = server.listenerCount('upgrade');
    realtime.attach(server);
    assert.equal(server.listenerCount('upgrade'), originalUpgradeListeners + 1);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('realtime lifecycle server failed to listen');
    const grant = realtime.createSession('run_delayed', {
      id: 'key_delayed', subjectId: 'owner', workspaceId: 'space', role: 'publisher',
      scopes: ['run:read'], kind: 'api_key', authority: 'workspace',
    });
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}${grant.websocket.url}`, grant.websocket.protocols);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
      socket.close();
      await closed;
      finishLookup(undefined);
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(subscriptions, 0);
      assert.equal(unsubscriptions, 0);
      await realtime.close();
      assert.equal(server.listenerCount('upgrade'), originalUpgradeListeners);
    } finally {
      finishLookup(undefined);
      socket.terminate();
      await realtime.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('binds a ChatKit realtime grant to its already-authorized deployment origin', async () => {
    const engine = {
      getRun: async () => undefined,
      subscribe: () => () => undefined,
    };
    const realtime = new RealtimeService(engine as never, ['https://builder.example']);
    const server = http.createServer();
    realtime.attach(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('realtime origin server failed to listen');
    const principal: AuthPrincipal = {
      id: 'chat-owner', subjectId: 'chat-owner', workspaceId: 'space', role: 'publisher',
      scopes: ['run:read'], kind: 'api_key', authority: 'workspace',
    };
    try {
      const rejected = realtime.createSession('run_chat', principal, { origin: 'https://chat.example' });
      const rejectedStatus = await new Promise<number>((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${address.port}${rejected.websocket.url}`, rejected.websocket.protocols, { origin: 'https://evil.example' });
        socket.once('unexpected-response', (_request, response) => { resolve(response.statusCode ?? 0); response.resume(); });
        socket.once('open', () => { socket.close(); reject(new Error('mismatched deployment origin connected')); });
        socket.once('error', () => undefined);
      });
      assert.equal(rejectedStatus, 403);

      const accepted = realtime.createSession('run_chat', principal, { origin: 'https://chat.example' });
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}${accepted.websocket.url}`, accepted.websocket.protocols, { origin: 'https://chat.example' });
      await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      socket.close();
    } finally {
      await realtime.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('streams replay plus live events with ownership, heartbeat, and one-time credentials', async () => {
    const workflow = await request('POST', '/api/v1/workflows', {
      name: 'Realtime approval',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'u', type: 'userApproval', config: { message: 'Continue?' } },
          { id: 'e', type: 'end', config: { output: 'approved' } },
          { id: 'n', type: 'end', config: { output: 'rejected' } },
        ],
        edges: [
          { id: 'su', source: 's', target: 'u' },
          { id: 'ue', source: 'u', target: 'e', sourceHandle: 'approved' },
          { id: 'un', source: 'u', target: 'n', sourceHandle: 'rejected' },
        ],
      },
    }, ownerToken);
    assert.equal(workflow.status, 200);
    const started = await request('POST', `/api/v1/workflows/${workflow.data.workflow.id}/runs`, { input: {} }, ownerToken);
    assert.equal(started.status, 200);
    const runId = started.data.run.id as string;

    let paused: any;
    for (let attempt = 0; attempt < 100; attempt++) {
      paused = (await request('GET', `/api/v1/runs/${runId}`, undefined, ownerToken)).data.run;
      if (paused.status === 'awaiting_approval') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(paused.status, 'awaiting_approval');

    assert.equal((await request('POST', '/api/v1/realtime/sessions', { runId }, intruderToken)).status, 404);
    assert.equal((await request('POST', '/api/v1/realtime/sessions', { runId, after: -1 }, ownerToken)).status, 400);
    const grant = await request('POST', '/api/v1/realtime/sessions', { runId, after: 0 }, ownerToken);
    assert.equal(grant.status, 200);
    assert.deepEqual(grant.data.session.websocket.protocols[0], 'willow.realtime.v1');
    assert.equal(await rejectedUpgradeStatus(grant.data.session, 'https://untrusted.example'), 403);

    const stream = connect(grant.data.session);
    await stream.opened;
    assert.equal(stream.socket.protocol, 'willow.realtime.v1');
    stream.socket.send(JSON.stringify({ type: 'ping' }));
    await waitForMessage(stream.messages, 'pong');
    const snapshot = await waitForMessage(stream.messages, 'run.snapshot');
    assert.equal(snapshot.run.id, runId);
    assert.equal('graph' in snapshot.run, false);
    assert.equal('checkpoint' in snapshot.run, false);

    const viewerGrant = await request('POST', '/api/v1/realtime/sessions', { runId }, ownerViewerToken);
    assert.deepEqual(viewerGrant.data.session.capabilities, ['events']);
    const viewerStream = connect(viewerGrant.data.session);
    await viewerStream.opened;
    viewerStream.socket.send(JSON.stringify({ type: 'run.cancel', requestId: 'read-only-cancel' }));
    const forbidden = await waitForMessage(viewerStream.messages, 'command.error');
    assert.equal(forbidden.requestId, 'read-only-cancel');
    assert.equal(forbidden.error.code, 'forbidden');
    viewerStream.socket.close();

    assert.deepEqual(grant.data.session.capabilities, ['events', 'run.cancel', 'approval.resolve']);
    stream.socket.send(JSON.stringify({
      type: 'approval.resolve',
      requestId: 'approve-command',
      approvalId: paused.pendingApproval.id,
      approved: true,
    }));
    // A lost acknowledgement may cause the client to retry. The same request
    // ID must be idempotent rather than attempting to resolve the approval a
    // second time and returning a misleading conflict.
    stream.socket.send(JSON.stringify({
      type: 'approval.resolve',
      requestId: 'approve-command',
      approvalId: paused.pendingApproval.id,
      approved: true,
    }));
    const command = await waitForMessage(stream.messages, 'command.completed');
    assert.equal(command.requestId, 'approve-command');
    assert.equal(command.command, 'approval.resolve');
    await new Promise<void>((resolve) => {
      const started = Date.now();
      const poll = () => stream.messages.filter((message) => message.type === 'command.completed' && message.requestId === 'approve-command').length >= 2
        ? resolve() : Date.now() - started > 5_000 ? resolve() : setTimeout(poll, 10);
      poll();
    });
    assert.equal(stream.messages.filter((message) => message.type === 'command.completed' && message.requestId === 'approve-command').length, 2);
    assert.equal(stream.messages.some((message) => message.type === 'command.error' && message.requestId === 'approve-command'), false);
    const closed = await stream.closed;
    assert.equal(closed.code, 1000);
    assert.equal((await waitForMessage(stream.messages, 'session.completed')).status, 'completed');
    const eventMessages = stream.messages.filter((message) => message.type === 'run.event');
    const sequences = eventMessages.map((message) => message.sequence as number);
    assert.deepEqual(sequences, [...new Set(sequences)].sort((a, b) => a - b));
    assert.ok(eventMessages.some((message) => message.event.type === 'approval.requested'));
    const resolvedEvent = eventMessages.find((message) => message.event.type === 'approval.resolved')?.event;
    assert.equal(resolvedEvent?.resolvedBy?.subjectId, 'realtime-owner');
    assert.equal(resolvedEvent?.resolvedBy?.kind, 'api_key');
    assert.ok(eventMessages.some((message) => message.event.type === 'run.completed'));
    assert.equal(await rejectedUpgradeStatus(grant.data.session), 401);
  });

  it('resolves a nested child approval through the parent realtime stream with replay', async () => {
    const child = await request('POST', '/api/v1/workflows', {
      name: 'Realtime nested child',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'u', type: 'userApproval', config: { message: 'Approve nested realtime work?' } },
          { id: 'e', type: 'end', config: { output: 'nested approved' } },
        ],
        edges: [
          { id: 'su', source: 's', target: 'u' },
          { id: 'ue', source: 'u', target: 'e', sourceHandle: 'approved' },
          { id: 'ur', source: 'u', target: 'e', sourceHandle: 'rejected' },
        ],
      },
    }, ownerToken);
    assert.equal(child.status, 200);
    const published = await request('POST', `/api/v1/workflows/${child.data.workflow.id}/publish`, {
      expectedRevision: child.data.workflow.draftRevision,
    }, ownerToken);
    assert.equal(published.status, 200);
    const parent = await request('POST', '/api/v1/workflows', {
      name: 'Realtime nested parent',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'call', type: 'subflow', name: 'Call child', config: { workflowId: child.data.workflow.id, version: published.data.version.version } },
          { id: 'e', type: 'end', config: { output: '{{call_child.output_text}}' } },
        ],
        edges: [{ id: 'sc', source: 's', target: 'call' }, { id: 'ce', source: 'call', target: 'e' }],
      },
    }, ownerToken);
    assert.equal(parent.status, 200);
    const started = await request('POST', `/api/v1/workflows/${parent.data.workflow.id}/runs`, { input: {} }, ownerToken);
    assert.equal(started.status, 200);
    const runId = started.data.run.id as string;
    let paused: any;
    for (let attempt = 0; attempt < 100; attempt++) {
      paused = (await request('GET', `/api/v1/runs/${runId}`, undefined, ownerToken)).data.run;
      if (paused.status === 'awaiting_approval') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(paused.status, 'awaiting_approval', paused.error);
    assert.ok(paused.nestedWait?.childRunId);

    const grant = await request('POST', '/api/v1/realtime/sessions', { runId, after: 0 }, ownerToken);
    assert.equal(grant.status, 200);
    const stream = connect(grant.data.session);
    await stream.opened;
    await waitForMessage(stream.messages, 'run.snapshot');
    const replayed = stream.messages.filter((message) => message.type === 'run.event');
    assert.ok(replayed.some((message) => message.event.type === 'subflow.started'));
    assert.ok(replayed.some((message) => message.event.type === 'subflow.paused'));
    assert.ok(replayed.some((message) => message.event.type === 'approval.requested'));

    stream.socket.send(JSON.stringify({
      type: 'approval.resolve',
      requestId: 'approve-nested-command',
      approvalId: paused.pendingApproval.id,
      approved: true,
    }));
    const command = await waitForMessage(stream.messages, 'command.completed');
    assert.equal(command.requestId, 'approve-nested-command');
    assert.equal(command.command, 'approval.resolve');
    assert.equal((await waitForMessage(stream.messages, 'session.completed')).status, 'completed');
    assert.equal((await stream.closed).code, 1000);
    const events = stream.messages.filter((message) => message.type === 'run.event');
    assert.ok(events.some((message) => message.event.type === 'approval.resolved'));
    assert.ok(events.some((message) => message.event.type === 'subflow.resumed'));
    assert.ok(events.some((message) => message.event.type === 'subflow.completed'));
    assert.ok(events.some((message) => message.event.type === 'run.completed'));
    const completed = await request('GET', `/api/v1/runs/${runId}`, undefined, ownerToken);
    assert.equal(completed.data.run.status, 'completed');
    assert.equal(completed.data.run.output, 'nested approved');
  });

  it('resumes a settled stream strictly after the supplied cursor', async () => {
    const workflow = await request('POST', '/api/v1/workflows', {
      name: 'Realtime replay',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'e', type: 'end', config: { output: 'done' } },
        ],
        edges: [{ id: 'se', source: 's', target: 'e' }],
      },
    }, ownerToken);
    assert.equal(workflow.status, 200);
    const started = await request('POST', `/api/v1/workflows/${workflow.data.workflow.id}/runs`, { input: {} }, ownerToken);
    const runId = started.data.run.id as string;
    for (let attempt = 0; attempt < 100; attempt++) {
      const current = await request('GET', `/api/v1/runs/${runId}`, undefined, ownerToken);
      if (current.data.run.status === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const trace = await request('GET', `/api/v1/runs/${runId}/trace`, undefined, ownerToken);
    const after = Math.max(0, trace.data.events.length - 2);
    const grant = await request('POST', '/api/v1/realtime/sessions', { runId, after }, ownerToken);
    assert.equal(grant.status, 200);
    const stream = connect(grant.data.session);
    await stream.opened;
    await stream.closed;
    const sequences = stream.messages.filter((message) => message.type === 'run.event').map((message) => message.sequence as number);
    assert.ok(sequences.length > 0);
    assert.ok(sequences.every((sequence) => sequence > after));
    assert.deepEqual(sequences, [...new Set(sequences)].sort((a, b) => a - b));
  });

  it('acknowledges cancellation before the terminal socket close', async () => {
    const workflow = await request('POST', '/api/v1/workflows', {
      name: 'Realtime cancellation',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          { id: 'u', type: 'userApproval', config: { message: 'Wait' } },
          { id: 'e', type: 'end', config: { output: 'done' } },
          { id: 'n', type: 'end', config: { output: 'stopped' } },
        ],
        edges: [
          { id: 'su', source: 's', target: 'u' },
          { id: 'ue', source: 'u', target: 'e', sourceHandle: 'approved' },
          { id: 'un', source: 'u', target: 'n', sourceHandle: 'rejected' },
        ],
      },
    }, ownerToken);
    const started = await request('POST', `/api/v1/workflows/${workflow.data.workflow.id}/runs`, { input: {} }, ownerToken);
    const runId = started.data.run.id as string;
    for (let attempt = 0; attempt < 100; attempt++) {
      const current = await request('GET', `/api/v1/runs/${runId}`, undefined, ownerToken);
      if (current.data.run.status === 'awaiting_approval') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const grant = await request('POST', '/api/v1/realtime/sessions', { runId }, ownerToken);
    const stream = connect(grant.data.session);
    await stream.opened;
    await waitForMessage(stream.messages, 'run.snapshot');
    stream.socket.send(JSON.stringify({ type: 'run.cancel', requestId: 'cancel-command' }));
    const command = await waitForMessage(stream.messages, 'command.completed');
    assert.equal(command.requestId, 'cancel-command');
    assert.equal(command.run.status, 'cancelled');
    assert.equal((await waitForMessage(stream.messages, 'session.completed')).status, 'cancelled');
    assert.equal((await stream.closed).code, 1000);
  });
});
