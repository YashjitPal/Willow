import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { WorkflowPresence } from '../src/domain/types.ts';
import { COLLECTIONS } from '../src/storage/index.ts';
import { CollaborationService } from '../src/services/collaboration.ts';
import { listen, makeApp, type App } from './helpers.ts';

let app: App;
let cleanup: () => Promise<void>;
let closeServer: () => Promise<void>;
let baseUrl: string;
let adminToken = '';
let aliceToken = '';
let alicePeerToken = '';
let aliceViewerToken = '';
let alicePublisherToken = '';
let bobToken = '';

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

async function createKey(name: string, role: 'viewer' | 'editor' | 'publisher', subjectId: string, workspaceId: string) {
  const created = await request('POST', '/api/v1/admin/api-keys', { name, role, subjectId, workspaceId }, adminToken);
  assert.equal(created.status, 200);
  return created.data.token as string;
}

async function createWorkflow(token = aliceToken) {
  const created = await request('POST', '/api/v1/workflows', {
    name: 'Collaborative workflow',
    graph: {
      nodes: [
        { id: 'start', type: 'start', data: {} },
        { id: 'finish', type: 'end', data: {} },
      ],
      edges: [{ id: 'start-finish', source: 'start', target: 'finish' }],
    },
  }, token);
  assert.equal(created.status, 200);
  return created.data.workflow as { id: string; draftRevision: number };
}

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, expected: string): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  const timeoutAt = Date.now() + 3_000;
  while (!text.includes(expected)) {
    if (Date.now() > timeoutAt) throw new Error(`timed out waiting for SSE event '${expected}': ${text}`);
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for SSE event '${expected}'`)), 3_000)),
    ]);
    if (result.done) break;
    text += decoder.decode(result.value, { stream: true });
  }
  return text;
}

before(async () => {
  ({ app, cleanup } = await makeApp());
  ({ baseUrl, close: closeServer } = await listen(app));
  const admin = await request('POST', '/api/v1/admin/api-keys', { name: 'collaboration admin', role: 'admin' });
  assert.equal(admin.status, 200);
  adminToken = admin.data.token;
  aliceToken = await createKey('Alice editor', 'editor', 'alice', 'acme');
  alicePeerToken = await createKey('Alice peer', 'editor', 'alice', 'acme');
  aliceViewerToken = await createKey('Alice viewer', 'viewer', 'alice', 'acme');
  alicePublisherToken = await createKey('Alice publisher', 'publisher', 'alice', 'acme');
  bobToken = await createKey('Bob editor', 'editor', 'bob', 'acme');
});

after(async () => {
  await closeServer();
  await cleanup();
});

describe('workflow collaboration', () => {
  it('stops presence sweep timers and subscribers when the service closes', () => {
    const isolated = new CollaborationService({} as App['storage'], {} as App['workflows']);
    let received = 0;
    const unsubscribe = isolated.subscribe('workflow_shutdown', () => { received += 1; });

    isolated.close();
    isolated.close();
    unsubscribe();

    assert.equal(received, 0);
    assert.throws(
      () => isolated.subscribe('workflow_after_shutdown', () => undefined),
      /collaboration service is closed/,
    );
  });

  it('removes subscribers whose connection callback fails', () => {
    const isolated = new CollaborationService({} as App['storage'], {} as App['workflows']);
    let failedCalls = 0;
    let healthyCalls = 0;
    isolated.subscribe('workflow_stale', () => { failedCalls += 1; throw new Error('socket closed'); });
    isolated.subscribe('workflow_stale', () => { healthyCalls += 1; });

    (isolated as any).emit('workflow_stale', { type: 'presence.left', presence: {} });
    (isolated as any).emit('workflow_stale', { type: 'presence.left', presence: {} });

    assert.equal(failedCalls, 1);
    assert.equal(healthyCalls, 2);
    isolated.close();
  });

  it('supports anchored review threads, replies, resolution, and optimistic concurrency', async () => {
    const workflow = await createWorkflow();
    const invalid = await request('POST', `/api/v1/workflows/${workflow.id}/comments`, {
      body: 'This node does not exist',
      anchor: { type: 'node', nodeId: 'missing' },
    }, aliceToken);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.data.error.code, 'invalid_collaboration_request');

    const created = await request('POST', `/api/v1/workflows/${workflow.id}/comments`, {
      body: 'Please verify the terminal response.',
      anchor: { type: 'node', nodeId: 'finish', fieldPath: 'config.output' },
      displayName: 'Alice',
    }, aliceToken);
    assert.equal(created.status, 200);
    assert.equal(created.data.thread.revision, 1);
    assert.equal(created.data.thread.draftRevision, workflow.draftRevision);
    assert.deepEqual(created.data.thread.anchor, { type: 'node', nodeId: 'finish', fieldPath: 'config.output' });

    const threadId = created.data.thread.id as string;
    const peerList = await request('GET', `/api/v1/workflows/${workflow.id}/comments`, undefined, alicePeerToken);
    assert.equal(peerList.status, 200);
    assert.deepEqual(peerList.data.threads.map((thread: any) => thread.id), [threadId]);
    assert.equal((await request('GET', `/api/v1/workflows/${workflow.id}/comments`, undefined, bobToken)).status, 404);

    const replied = await request('POST', `/api/v1/workflows/${workflow.id}/comments/${threadId}/replies`, {
      body: 'Verified. The output is intentional.',
      expectedRevision: 1,
      displayName: 'Peer reviewer',
    }, alicePeerToken);
    assert.equal(replied.status, 200);
    assert.equal(replied.data.thread.revision, 2);
    assert.equal(replied.data.thread.messages.length, 2);

    const stale = await request('POST', `/api/v1/workflows/${workflow.id}/comments/${threadId}/replies`, {
      body: 'Stale concurrent reply', expectedRevision: 1,
    }, aliceToken);
    assert.equal(stale.status, 409);
    assert.equal(stale.data.error.code, 'review_revision_conflict');
    assert.equal(stale.data.error.details.currentRevision, 2);

    const resolved = await request('PATCH', `/api/v1/workflows/${workflow.id}/comments/${threadId}`, {
      status: 'resolved', expectedRevision: 2,
    }, aliceToken);
    assert.equal(resolved.status, 200);
    assert.equal(resolved.data.thread.status, 'resolved');
    assert.equal(resolved.data.thread.revision, 3);
    assert.ok(resolved.data.thread.resolvedAt);

    const staleDelete = await request('DELETE', `/api/v1/workflows/${workflow.id}/comments/${threadId}?expectedRevision=2`, undefined, aliceToken);
    assert.equal(staleDelete.status, 409);
    assert.equal(staleDelete.data.error.code, 'review_revision_conflict');
    assert.equal(staleDelete.data.error.details.currentRevision, 3);

    const deleted = await request('DELETE', `/api/v1/workflows/${workflow.id}/comments/${threadId}?expectedRevision=3`, undefined, aliceToken);
    assert.equal(deleted.status, 200);
    assert.equal(deleted.data.ok, true);

    const openOnly = await request('GET', `/api/v1/workflows/${workflow.id}/comments?includeResolved=false`, undefined, aliceToken);
    assert.deepEqual(openOnly.data.threads, []);
  });

  it('tracks viewer presence with validated cursor and selection leases', async () => {
    const workflow = await createWorkflow();
    const heartbeat = await request('PUT', `/api/v1/workflows/${workflow.id}/presence`, {
      clientId: 'browser-tab-1',
      displayName: 'Read-only reviewer',
      color: '#2f80ed',
      cursor: { x: 120.5, y: -42 },
      selectedNodeIds: ['finish'],
      activeNodeId: 'finish',
      ttlSeconds: 5,
    }, aliceViewerToken);
    assert.equal(heartbeat.status, 200);
    assert.equal(heartbeat.data.presence.collaborator.role, 'viewer');
    assert.deepEqual(heartbeat.data.presence.selectedNodeIds, ['finish']);

    const listed = await request('GET', `/api/v1/workflows/${workflow.id}/presence`, undefined, aliceToken);
    assert.equal(listed.status, 200);
    assert.equal(listed.data.presence.length, 1);
    assert.equal(listed.data.presence[0].clientId, 'browser-tab-1');
    assert.equal((await request('GET', `/api/v1/workflows/${workflow.id}/presence`, undefined, bobToken)).status, 404);

    const invalid = await request('PUT', `/api/v1/workflows/${workflow.id}/presence`, {
      clientId: 'browser-tab-2', selectedNodeIds: ['unknown'],
    }, aliceViewerToken);
    assert.equal(invalid.status, 400);

    const expired: WorkflowPresence = {
      workflowId: workflow.id,
      workspaceId: 'acme',
      clientId: 'expired-tab',
      collaborator: { subjectId: 'alice', actorId: 'expired', role: 'viewer' },
      selectedNodeIds: [],
      lastSeenAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2020-01-01T00:00:01.000Z',
    };
    await app.storage.put(COLLECTIONS.workflowPresence, `${workflow.id}:alice:expired-tab`, expired, workflow.id);
    const cleaned = await request('GET', `/api/v1/workflows/${workflow.id}/presence`, undefined, aliceToken);
    assert.deepEqual(cleaned.data.presence.map((presence: any) => presence.clientId), ['browser-tab-1']);
    assert.equal(await app.storage.get(COLLECTIONS.workflowPresence, `${workflow.id}:alice:expired-tab`), undefined);

    const left = await request('DELETE', `/api/v1/workflows/${workflow.id}/presence?clientId=browser-tab-1`, undefined, aliceViewerToken);
    assert.equal(left.status, 200);
    assert.equal(left.data.ok, true);
    assert.deepEqual((await request('GET', `/api/v1/workflows/${workflow.id}/presence`, undefined, aliceToken)).data.presence, []);
  });

  it('streams an initial snapshot and subsequent collaboration events over SSE', async () => {
    const workflow = await createWorkflow();
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/v1/workflows/${workflow.id}/collaboration/events`, {
      headers: { authorization: `Bearer ${aliceToken}` },
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
    const reader = response.body!.getReader();
    try {
      const snapshot = await readUntil(reader, 'event: collaboration.snapshot');
      assert.match(snapshot, /"threads":\[\]/);

      const created = await request('POST', `/api/v1/workflows/${workflow.id}/comments`, {
        body: 'Live review', anchor: { type: 'canvas', x: 10, y: 20 },
      }, alicePeerToken);
      assert.equal(created.status, 200);
      const event = await readUntil(reader, 'event: review.created');
      assert.match(event, new RegExp(created.data.thread.id));
    } finally {
      controller.abort();
      await reader.cancel().catch(() => undefined);
    }
  });

  it('automatically broadcasts expired presence leases to connected clients', async () => {
    const workflow = await createWorkflow();
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/v1/workflows/${workflow.id}/collaboration/events`, {
      headers: { authorization: `Bearer ${aliceToken}` },
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    try {
      await readUntil(reader, 'event: collaboration.snapshot');
      const expired: WorkflowPresence = {
        workflowId: workflow.id,
        workspaceId: 'acme',
        clientId: 'disconnected-tab',
        collaborator: { subjectId: 'alice', actorId: 'expired', role: 'viewer' },
        selectedNodeIds: [],
        lastSeenAt: '2020-01-01T00:00:00.000Z',
        expiresAt: '2020-01-01T00:00:01.000Z',
      };
      const id = `${workflow.id}:alice:disconnected-tab`;
      await app.storage.put(COLLECTIONS.workflowPresence, id, expired, workflow.id);
      const event = await readUntil(reader, 'event: presence.left');
      assert.match(event, /disconnected-tab/);
      assert.equal(await app.storage.get(COLLECTIONS.workflowPresence, id), undefined);
    } finally {
      controller.abort();
      await reader.cancel().catch(() => undefined);
    }
  });

  it('removes durable collaboration state when a workflow is deleted', async () => {
    const workflow = await createWorkflow(alicePublisherToken);
    const thread = await request('POST', `/api/v1/workflows/${workflow.id}/comments`, {
      body: 'Temporary review', anchor: { type: 'edge', edgeId: 'start-finish' },
    }, alicePublisherToken);
    assert.equal(thread.status, 200);
    assert.equal((await request('PUT', `/api/v1/workflows/${workflow.id}/presence`, { clientId: 'cleanup-tab' }, alicePublisherToken)).status, 200);
    assert.equal((await request('DELETE', `/api/v1/workflows/${workflow.id}`, undefined, alicePublisherToken)).status, 200);
    assert.equal((await app.storage.list(COLLECTIONS.workflowReviewThreads, { ref: workflow.id })).length, 0);
    assert.equal((await app.storage.list(COLLECTIONS.workflowPresence, { ref: workflow.id })).length, 0);
  });
});
