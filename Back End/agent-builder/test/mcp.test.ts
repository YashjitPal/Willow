/**
 * End-to-end MCP test: spins up a real MCP server (SDK McpServer over
 * Streamable HTTP on an ephemeral port), registers it with the backend,
 * lists tools, calls a tool directly, and exercises both the standalone MCP
 * node and the agent-attached MCP tool — including the approval pause flow.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { listen, makeApp, waitForRun, type App } from './helpers.ts';

let app: App;
let cleanup: () => Promise<void>;
let baseUrl: string;
let closeApi: () => Promise<void>;
let mcpHttpServer: http.Server;
let mcpUrl: string;

before(async () => {
  ({ app, cleanup } = await makeApp());
  ({ baseUrl, close: closeApi } = await listen(app));

  // ---- in-process MCP server (stateless streamable http) ----
  // Stateless pattern: a fresh McpServer + transport per request.
  const makeMcpServer = () => {
    const s = new McpServer({ name: 'test-mcp', version: '1.0.0' });
    s.registerTool(
      'add',
      {
        description: 'Add two numbers',
        inputSchema: { a: z.number(), b: z.number() },
      },
      async ({ a, b }) => ({
        content: [{ type: 'text', text: String(a + b) }],
      }),
    );
    s.registerTool(
      'greet',
      {
        description: 'Greet a person',
        inputSchema: { name: z.string() },
      },
      async ({ name }) => ({
        content: [{ type: 'text', text: `Hello, ${name}!` }],
      }),
    );
    return s;
  };

  mcpHttpServer = http.createServer(async (req, res) => {
    try {
      const mcpServer = makeMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
        enableJsonResponse: true,
      });
      res.on('close', () => {
        void transport.close();
        void mcpServer.close();
      });
      await mcpServer.connect(transport);

      // collect body
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const bodyText = Buffer.concat(chunks).toString('utf8');
      const body = bodyText ? JSON.parse(bodyText) : undefined;
      await transport.handleRequest(req, res, body);
    } catch (e) {
      if (!res.writableEnded) {
        res.writeHead(500).end(JSON.stringify({ error: (e as Error).message }));
      }
    }
  });
  await new Promise<void>((resolve) => mcpHttpServer.listen(0, '127.0.0.1', resolve));
  const addr = mcpHttpServer.address();
  if (!addr || typeof addr === 'string') throw new Error('no mcp address');
  mcpUrl = `http://127.0.0.1:${addr.port}/mcp`;
});

after(async () => {
  await closeApi();
  await cleanup();
  mcpHttpServer.close();
  mcpHttpServer.closeAllConnections?.();
});

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

let serverId: string;

describe('MCP end-to-end', () => {
  it('registers + connects and discovers tools', async () => {
    const created = await api('POST', '/api/v1/mcp/servers', {
      label: 'test_mcp',
      url: mcpUrl,
    });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.equal(created.data.warning, undefined, created.data.warning);
    serverId = created.data.server.id;
    assert.equal(created.data.server.status, 'connected');
    const toolNames = created.data.server.tools.map((t: any) => t.name).sort();
    assert.deepEqual(toolNames, ['add', 'greet']);
  });

  it('calls a tool directly through the registry', async () => {
    const res = await api('POST', `/api/v1/mcp/servers/${serverId}/tools/add/call`, {
      arguments: { a: 19, b: 23 },
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.result, '42');
  });

  it('standalone MCP node executes with templated arguments', async () => {
    const created = await api('POST', '/api/v1/workflows', {
      name: 'mcp-node',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          {
            id: 'm',
            type: 'mcp',
            name: 'Greeter',
            config: {
              serverId,
              tool: 'greet',
              arguments: { name: '{{workflow.input_as_text}}' },
              requireApproval: 'never',
            },
          },
          { id: 'e', type: 'end', config: { output: '{{greeter.output_text}}' } },
        ],
        edges: [
          { id: 'e1', source: 's', target: 'm' },
          { id: 'e2', source: 'm', target: 'e' },
        ],
      },
    });
    const wfId = created.data.workflow.id;
    const run = await app.engine.createRun({ workflowId: wfId, input: { input_as_text: 'Willow' } });
    const done = await waitForRun(app, run.id, ['completed', 'failed']);
    assert.equal(done.status, 'completed', done.error);
    assert.equal(done.output, 'Hello, Willow!');
  });

  it('MCP node with requireApproval pauses then executes on approve', async () => {
    const created = await api('POST', '/api/v1/workflows', {
      name: 'mcp-approval',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          {
            id: 'm',
            type: 'mcp',
            name: 'Adder',
            config: {
              serverId,
              tool: 'add',
              arguments: { a: 20, b: 22 },
              requireApproval: 'always',
            },
          },
          { id: 'e', type: 'end', config: { output: 'sum={{adder.output_text}}' } },
        ],
        edges: [
          { id: 'e1', source: 's', target: 'm' },
          { id: 'e2', source: 'm', target: 'e' },
        ],
      },
    });
    const wfId = created.data.workflow.id;
    const run = await app.engine.createRun({ workflowId: wfId, input: {} });
    const paused = await waitForRun(app, run.id, ['awaiting_approval']);
    assert.equal(paused.pendingApproval?.kind, 'mcp_tool');
    assert.equal(paused.pendingApproval?.toolCall?.tool, 'add');

    await app.engine.resolveApproval(run.id, paused.pendingApproval!.id, { approved: true });
    const done = await waitForRun(app, run.id, ['completed', 'failed']);
    assert.equal(done.status, 'completed', done.error);
    assert.equal(done.output, 'sum=42');
  });

  it('agent with an attached MCP tool calls it mid-loop', async () => {
    const created = await api('POST', '/api/v1/workflows', {
      name: 'mcp-agent',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          {
            id: 'a',
            type: 'agent',
            config: {
              instructions: 'use the adder',
              model: 'mock/tool:test_mcp__add',
              tools: [{ kind: 'mcp', serverId, requireApproval: 'never' }],
              outputFormat: 'text',
              includeChatHistory: false,
              writeToConversationHistory: true,
              continueOnError: false,
            },
          },
        ],
        edges: [{ id: 'e1', source: 's', target: 'a' }],
      },
    });
    const wfId = created.data.workflow.id;
    // mock/tool model calls the named tool with args parsed from the input JSON
    const run = await app.engine.createRun({
      workflowId: wfId,
      input: { input_as_text: '{"a": 40, "b": 2}' },
    });
    const done = await waitForRun(app, run.id, ['completed', 'failed']);
    assert.equal(done.status, 'completed', done.error);
    assert.match(String(done.output), /TOOL_RESULT: 42/);
  });

  it('agent MCP tool with requireApproval=always pauses mid-loop and resumes', async () => {
    const created = await api('POST', '/api/v1/workflows', {
      name: 'mcp-agent-approval',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          {
            id: 'a',
            type: 'agent',
            config: {
              instructions: 'use the adder',
              model: 'mock/tool:test_mcp__add',
              tools: [{ kind: 'mcp', serverId, requireApproval: 'always' }],
              outputFormat: 'text',
              includeChatHistory: false,
              writeToConversationHistory: true,
              continueOnError: false,
            },
          },
        ],
        edges: [{ id: 'e1', source: 's', target: 'a' }],
      },
    });
    const wfId = created.data.workflow.id;
    const run = await app.engine.createRun({
      workflowId: wfId,
      input: { input_as_text: '{"a": 1, "b": 2}' },
    });
    const paused = await waitForRun(app, run.id, ['awaiting_approval']);
    assert.equal(paused.pendingApproval?.kind, 'mcp_tool');

    await app.engine.resolveApproval(run.id, paused.pendingApproval!.id, { approved: true });
    const done = await waitForRun(app, run.id, ['completed', 'failed']);
    assert.equal(done.status, 'completed', done.error);
    assert.match(String(done.output), /TOOL_RESULT: 3/);
  });

  it('rejecting the agent MCP tool feeds a denial to the model', async () => {
    const created = await api('POST', '/api/v1/workflows', {
      name: 'mcp-agent-reject',
      graph: {
        nodes: [
          { id: 's', type: 'start', data: {} },
          {
            id: 'a',
            type: 'agent',
            config: {
              instructions: '',
              model: 'mock/tool:test_mcp__add',
              tools: [{ kind: 'mcp', serverId, requireApproval: 'always' }],
              outputFormat: 'text',
              includeChatHistory: false,
              writeToConversationHistory: true,
              continueOnError: false,
            },
          },
        ],
        edges: [{ id: 'e1', source: 's', target: 'a' }],
      },
    });
    const wfId = created.data.workflow.id;
    const run = await app.engine.createRun({ workflowId: wfId, input: { input_as_text: '{}' } });
    const paused = await waitForRun(app, run.id, ['awaiting_approval']);
    await app.engine.resolveApproval(run.id, paused.pendingApproval!.id, { approved: false });
    const done = await waitForRun(app, run.id, ['completed', 'failed']);
    assert.equal(done.status, 'completed', done.error);
    assert.match(String(done.output), /declined/);
  });

  it('allowedTools filtering restricts what the agent sees', async () => {
    const { buildToolBindings } = await import('../src/engine/nodes/agent.ts');
    const bindings = await buildToolBindings(
      {
        run: { id: 'x', input: {} },
        graph: { nodes: [], edges: [] },
        varNames: new Map(),
        checkpoint: { state: {}, nodeOutputs: {}, history: [], whileCounters: {}, currentNodeId: null, lastAgentText: '' },
        services: { mcp: app.mcp, vectorStores: app.vectorStores, config: app.config, storage: app.storage },
        emit: async () => {},
        abortSignal: new AbortController().signal,
        takeResume: () => undefined,
        addUsage: () => {},
      } as never,
      {
        instructions: '',
        model: 'mock/echo',
        includeChatHistory: false,
        writeToConversationHistory: false,
        tools: [{ kind: 'mcp', serverId, allowedTools: ['greet'] }],
        outputFormat: 'text',
        continueOnError: false,
      },
    );
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].mcpToolName, 'greet');
  });
});
