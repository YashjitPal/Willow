import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { makeApp } from './helpers.ts';

describe('MCP connection recovery', () => {
  it('does not resurrect an in-flight connection after disconnect', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const registration = await app.mcp.register({
        label: 'delayed MCP',
        url: 'https://example.invalid/mcp',
      });
      let release!: (client: Client) => void;
      const opened = new Promise<Client>((resolve) => { release = resolve; });
      let closeCalls = 0;
      let toolCalls = 0;
      const client = {
        close: async () => { closeCalls += 1; },
        callTool: async () => {
          toolCalls += 1;
          return { content: [{ type: 'text', text: 'should not execute' }] };
        },
      } as unknown as Client;

      (app.mcp as unknown as { openClient: () => Promise<Client> }).openClient = () => opened;
      const pending = app.mcp.callTool(registration.id, 'dangerous_action', {});
      await new Promise<void>((resolve) => setImmediate(resolve));

      await app.mcp.disconnect(registration.id);
      release(client);

      await assert.rejects(pending, /connection .* superseded/i);
      assert.equal(closeCalls, 1);
      assert.equal(toolCalls, 0);
      assert.equal((app.mcp as unknown as { connections: Map<string, unknown> }).connections.has(registration.id), false);
    } finally {
      await cleanup();
    }
  });

  it('invalidates connection attempts during global shutdown', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const registration = await app.mcp.register({
        label: 'shutdown MCP',
        url: 'https://example.invalid/mcp',
      });
      let release!: (client: Client) => void;
      const opened = new Promise<Client>((resolve) => { release = resolve; });
      let closeCalls = 0;
      const client = {
        close: async () => { closeCalls += 1; },
        callTool: async () => ({ content: [] }),
      } as unknown as Client;

      (app.mcp as unknown as { openClient: () => Promise<Client> }).openClient = () => opened;
      const pending = app.mcp.callTool(registration.id, 'read', {});
      await new Promise<void>((resolve) => setImmediate(resolve));

      await app.mcp.closeAll();
      release(client);

      await assert.rejects(pending, /connection .* superseded/i);
      assert.equal(closeCalls, 1);
    } finally {
      await cleanup();
    }
  });

  it('does not publish tools discovered after a concurrent disconnect', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const registration = await app.mcp.register({
        label: 'discovery MCP',
        url: 'https://example.invalid/mcp',
      });
      let releaseTools!: () => void;
      const toolsReady = new Promise<void>((resolve) => { releaseTools = resolve; });
      let closeCalls = 0;
      const client = {
        close: async () => { closeCalls += 1; },
        listTools: async () => {
          await toolsReady;
          return { tools: [{ name: 'stale_tool', inputSchema: { type: 'object' } }] };
        },
      } as unknown as Client;
      (app.mcp as unknown as { openClient: () => Promise<Client> }).openClient = async () => client;

      const pending = app.mcp.listTools(registration.id, true);
      await new Promise<void>((resolve) => setImmediate(resolve));
      await app.mcp.disconnect(registration.id);
      releaseTools();

      await assert.rejects(pending, /connection .* superseded/i);
      const stored = await app.mcp.get(registration.id);
      assert.equal(stored?.status, 'unconnected');
      assert.equal(stored?.tools, undefined);
      assert.equal(closeCalls, 1);
    } finally {
      await cleanup();
    }
  });

  it('follows MCP listTools cursors', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const registration = await app.mcp.register({ label: 'paged MCP', url: 'https://example.invalid/mcp' });
      const cursors: Array<string | undefined> = [];
      const client = {
        close: async () => {},
        listTools: async (params?: { cursor?: string }) => {
          cursors.push(params?.cursor);
          if (!params?.cursor) return { tools: [{ name: 'first' }], nextCursor: 'page-2' };
          return { tools: [{ name: 'second' }] };
        },
      } as unknown as Client;
      (app.mcp as unknown as { openClient: () => Promise<Client> }).openClient = async () => client;

      const tools = await app.mcp.listTools(registration.id, true);
      assert.deepEqual(tools.map((tool) => tool.name), ['first', 'second']);
      assert.deepEqual(cursors, [undefined, 'page-2']);
    } finally {
      await cleanup();
    }
  });

  it('rejects repeated discovery cursors and discards the failed connection', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const registration = await app.mcp.register({ label: 'looping MCP', url: 'https://example.invalid/mcp' });
      let closeCalls = 0;
      const client = {
        close: async () => { closeCalls += 1; },
        listTools: async (params?: { cursor?: string }) => params?.cursor
          ? { tools: [{ name: 'partial_second' }], nextCursor: 'page-2' }
          : { tools: [{ name: 'partial_first' }], nextCursor: 'page-2' },
      } as unknown as Client;
      (app.mcp as unknown as { openClient: () => Promise<Client> }).openClient = async () => client;

      await assert.rejects(app.mcp.listTools(registration.id, true), /repeated cursor 'page-2'/i);
      const stored = await app.mcp.get(registration.id);
      assert.equal(stored?.status, 'error');
      assert.equal(stored?.tools, undefined);
      assert.match(stored?.lastError ?? '', /repeated cursor/i);
      assert.equal(closeCalls, 1);
      assert.equal((app.mcp as unknown as { connections: Map<string, unknown> }).connections.has(registration.id), false);
    } finally {
      await cleanup();
    }
  });
});
