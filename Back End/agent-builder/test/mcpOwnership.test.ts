import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { COLLECTIONS } from '../src/storage/index.ts';
import { listen, makeApp, waitForRun, type App } from './helpers.ts';

let app: App;
let cleanup: () => Promise<void>;
let apiBase = '';
let closeApi: () => Promise<void>;
let mcpServer: http.Server;
let mcpUrl = '';
let requestCount = 0;
const authorizations: string[] = [];

async function request(method: string, path: string, body?: unknown, token?: string) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : undefined };
}

before(async () => {
  ({ app, cleanup } = await makeApp());
  ({ baseUrl: apiBase, close: closeApi } = await listen(app));
  mcpServer = http.createServer(async (req, res) => {
    requestCount += 1;
    if (req.headers.authorization) authorizations.push(req.headers.authorization);
    const server = new McpServer({ name: 'owned-mcp', version: '1.0.0' });
    server.registerTool('add', { inputSchema: { a: z.number(), b: z.number() } }, async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    await transport.handleRequest(req, res, text ? JSON.parse(text) : undefined);
  });
  await new Promise<void>((resolve) => mcpServer.listen(0, '127.0.0.1', resolve));
  const address = mcpServer.address();
  if (!address || typeof address === 'string') throw new Error('MCP server did not bind');
  mcpUrl = `http://127.0.0.1:${address.port}/mcp`;
});

after(async () => {
  await closeApi();
  await cleanup();
  mcpServer.close();
  mcpServer.closeAllConnections?.();
});

describe('MCP ownership isolation', () => {
  it('guards registry, vaulted credentials, tool calls, and runtime nodes by owner/workspace', async () => {
    const admin = await request('POST', '/api/v1/admin/api-keys', { name: 'MCP admin', role: 'admin' });
    const scopes = ['workflow:read', 'workflow:write', 'run:create', 'run:read', 'mcp:read', 'mcp:manage'];
    const owner = await request('POST', '/api/v1/admin/api-keys', { name: 'MCP owner', role: 'editor', scopes, subjectId: 'mcp-owner', workspaceId: 'acme' }, admin.data.token);
    const ownerRotated = await request('POST', '/api/v1/admin/api-keys', { name: 'MCP owner rotated', role: 'editor', scopes, subjectId: 'mcp-owner', workspaceId: 'acme' }, admin.data.token);
    const intruder = await request('POST', '/api/v1/admin/api-keys', { name: 'MCP intruder', role: 'editor', scopes, subjectId: 'mcp-intruder', workspaceId: 'acme' }, admin.data.token);
    const defaultOwner = await request('POST', '/api/v1/admin/api-keys', { name: 'Legacy owner', role: 'viewer', scopes: ['mcp:read'], subjectId: 'default', workspaceId: 'default' }, admin.data.token);
    const otherWorkspaceAdmin = await request('POST', '/api/v1/admin/api-keys', { name: 'Other MCP workspace admin', role: 'admin', subjectId: 'other-mcp-admin', workspaceId: 'other' }, admin.data.token);

    const created = await request('POST', '/api/v1/mcp/servers', {
      label: 'owner_mcp', url: mcpUrl, authType: 'Access token / API key', token: 'vaulted-owner-token',
    }, owner.data.token);
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const serverId = created.data.server.id;
    assert.deepEqual([created.data.server.ownerId, created.data.server.workspaceId], ['mcp-owner', 'acme']);
    assert.ok(authorizations.includes('Bearer vaulted-owner-token'));

    const basicCreated = await request('POST', '/api/v1/mcp/servers', {
      label: 'owner_basic_mcp',
      url: mcpUrl,
      authType: 'Basic Auth',
      auth: { type: 'basic', username: 'mcp-user', password: 'mcp-password' },
    }, owner.data.token);
    assert.equal(basicCreated.status, 200, JSON.stringify(basicCreated.data));
    assert.equal(basicCreated.data.server.auth.type, 'basic');
    assert.ok(authorizations.includes(`Basic ${Buffer.from('mcp-user:mcp-password').toString('base64')}`));

    const intruderList = await request('GET', '/api/v1/mcp/servers', undefined, intruder.data.token);
    assert.equal(intruderList.status, 200);
    assert.equal(intruderList.data.servers.some((server: any) => server.id === serverId), false);
    assert.equal((await request('GET', '/api/v1/mcp/servers', undefined, ownerRotated.data.token)).data.servers.some((server: any) => server.id === serverId), true);
    assert.equal((await request('GET', '/api/v1/mcp/servers', undefined, admin.data.token)).data.servers.some((server: any) => server.id === serverId), true);
    assert.equal((await request('GET', '/api/v1/mcp/servers', undefined, otherWorkspaceAdmin.data.token)).data.servers.some((server: any) => server.id === serverId), false);
    assert.equal((await request('GET', `/api/v1/mcp/servers/${serverId}/tools`, undefined, otherWorkspaceAdmin.data.token)).status, 404);

    const beforeDenied = requestCount;
    assert.equal((await request('PATCH', `/api/v1/mcp/servers/${serverId}`, { label: 'stolen' }, intruder.data.token)).status, 404);
    assert.equal((await request('POST', `/api/v1/mcp/servers/${serverId}/connect`, {}, intruder.data.token)).status, 404);
    assert.equal((await request('GET', `/api/v1/mcp/servers/${serverId}/tools`, undefined, intruder.data.token)).status, 404);
    assert.equal((await request('POST', `/api/v1/mcp/servers/${serverId}/tools/add/call`, { arguments: { a: 1, b: 2 } }, intruder.data.token)).status, 404);
    assert.equal((await request('DELETE', `/api/v1/mcp/servers/${serverId}`, undefined, intruder.data.token)).status, 404);
    assert.equal(requestCount, beforeDenied, 'foreign calls must not use the cached connection or vaulted bearer credential');

    const direct = await request('POST', `/api/v1/mcp/servers/${serverId}/tools/add/call`, { arguments: { a: 19, b: 23 } }, ownerRotated.data.token);
    assert.equal(direct.status, 200);
    assert.equal(direct.data.result, '42');

    const runtimeRequests = requestCount;
    const mcpWorkflow = await request('POST', '/api/v1/workflows', {
      name: 'Foreign MCP node',
      graph: { nodes: [
        { id: 's', type: 'start', config: {} },
        { id: 'm', type: 'mcp', name: 'Adder', config: { serverId, tool: 'add', arguments: { a: 20, b: 22 }, requireApproval: 'never' } },
        { id: 'e', type: 'end', config: { output: '{{adder.output_text}}' } },
      ], edges: [{ id: 'sm', source: 's', target: 'm' }, { id: 'me', source: 'm', target: 'e' }] },
    }, intruder.data.token);
    const mcpRun = await request('POST', `/api/v1/workflows/${mcpWorkflow.data.workflow.id}/runs`, { input: {} }, intruder.data.token);
    const mcpDone = await waitForRun(app, mcpRun.data.run.id, ['completed', 'failed']);
    assert.equal(mcpDone.status, 'failed');
    assert.match(mcpDone.error ?? '', /MCP server .* not found/);

    const agentWorkflow = await request('POST', '/api/v1/workflows', {
      name: 'Foreign Agent MCP tool',
      graph: { nodes: [
        { id: 's', type: 'start', config: {} },
        { id: 'a', type: 'agent', config: { instructions: '', model: 'mock/tool:owner_mcp__add', tools: [{ kind: 'mcp', serverId, requireApproval: 'never' }], outputFormat: 'text' } },
      ], edges: [{ id: 'sa', source: 's', target: 'a' }] },
    }, intruder.data.token);
    const agentRun = await request('POST', `/api/v1/workflows/${agentWorkflow.data.workflow.id}/runs`, { input: { input_as_text: '{"a":1,"b":2}' } }, intruder.data.token);
    const agentDone = await waitForRun(app, agentRun.data.run.id, ['completed', 'failed']);
    assert.equal(agentDone.status, 'failed');
    assert.match(agentDone.error ?? '', /unknown MCP server/);
    assert.equal(requestCount, runtimeRequests, 'foreign runtime nodes must fail before credentialed MCP traffic');

    const legacy = await app.mcp.register({ label: 'legacy_mcp', url: 'https://example.invalid/mcp' });
    const stored = await app.storage.get<any>(COLLECTIONS.mcpServers, legacy.id);
    delete stored.ownerId;
    delete stored.workspaceId;
    await app.storage.put(COLLECTIONS.mcpServers, legacy.id, stored);
    assert.equal((await request('GET', '/api/v1/mcp/servers', undefined, defaultOwner.data.token)).data.servers.some((server: any) => server.id === legacy.id), true);
    assert.equal((await request('GET', '/api/v1/mcp/servers', undefined, intruder.data.token)).data.servers.some((server: any) => server.id === legacy.id), false);
  });
});
