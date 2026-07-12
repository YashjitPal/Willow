/**
 * MCP client manager — registers servers, connects over Streamable HTTP
 * (falling back to legacy SSE) or stdio, lists tools, and executes calls.
 * Connections are cached per server and re-established on demand.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type {
  JsonObject,
  JsonValue,
  McpServerRegistration,
  McpToolInfo,
} from '../domain/types.ts';
import { COLLECTIONS, type Storage } from '../storage/index.ts';
import { ids, nowIso } from '../util/id.ts';
import { createLogger } from '../util/log.ts';

const log = createLogger('mcp');

export interface RegisterServerInput {
  label: string;
  description?: string;
  origin?: 'hosted' | 'third-party' | 'custom';
  connector?: string;
  url?: string;
  command?: string;
  args?: string[];
  transport?: 'streamable-http' | 'sse' | 'stdio';
  auth?: McpServerRegistration['auth'];
}

function authHeaders(auth: McpServerRegistration['auth']): Record<string, string> {
  switch (auth.type) {
    case 'bearer':
      return { authorization: `Bearer ${auth.token}` };
    case 'basic':
      return {
        authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`,
      };
    case 'headers':
      return { ...auth.headers };
    default:
      return {};
  }
}

interface LiveConnection {
  client: Client;
  connectedAt: number;
}

export class McpManager {
  private connections = new Map<string, LiveConnection>();
  /** Single-flight guard: in-progress connection attempts by server id. */
  private connecting = new Map<string, Promise<Client>>();
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  // ---------------- registry ----------------

  async register(input: RegisterServerInput): Promise<McpServerRegistration> {
    if (!input.url && !input.command) {
      throw new Error('MCP server requires a url (http/sse) or command (stdio)');
    }
    const reg: McpServerRegistration = {
      id: ids.mcpServer(),
      label: input.label || 'mcp_server',
      description: input.description,
      origin: input.origin ?? 'custom',
      connector: input.connector,
      transport: input.transport ?? (input.command ? 'stdio' : 'streamable-http'),
      url: input.url,
      command: input.command,
      args: input.args,
      auth: input.auth ?? { type: 'none' },
      status: 'unconnected',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await this.storage.put(COLLECTIONS.mcpServers, reg.id, reg);
    return reg;
  }

  async update(
    id: string,
    patch: Partial<RegisterServerInput>,
  ): Promise<McpServerRegistration | undefined> {
    const reg = await this.get(id);
    if (!reg) return undefined;
    if (patch.label !== undefined) reg.label = patch.label;
    if (patch.description !== undefined) reg.description = patch.description;
    if (patch.url !== undefined) reg.url = patch.url;
    if (patch.command !== undefined) reg.command = patch.command;
    if (patch.args !== undefined) reg.args = patch.args;
    if (patch.transport !== undefined) reg.transport = patch.transport;
    if (patch.auth !== undefined) reg.auth = patch.auth;
    reg.updatedAt = nowIso();
    reg.status = 'unconnected';
    await this.disconnect(id);
    await this.storage.put(COLLECTIONS.mcpServers, reg.id, reg);
    return reg;
  }

  async get(id: string): Promise<McpServerRegistration | undefined> {
    return this.storage.get<McpServerRegistration>(COLLECTIONS.mcpServers, id);
  }

  async list(): Promise<McpServerRegistration[]> {
    const rows = await this.storage.list<McpServerRegistration>(COLLECTIONS.mcpServers);
    return rows.map((r) => r.doc);
  }

  async remove(id: string): Promise<boolean> {
    await this.disconnect(id);
    return this.storage.delete(COLLECTIONS.mcpServers, id);
  }

  // ---------------- connections ----------------

  private async openClient(reg: McpServerRegistration): Promise<Client> {
    const clientInfo = { name: 'willow-agent-builder', version: '0.1.0' };

    if (reg.transport === 'stdio') {
      if (!reg.command) throw new Error('stdio transport requires a command');
      const transport = new StdioClientTransport({
        command: reg.command,
        args: reg.args ?? [],
      });
      const client = new Client(clientInfo);
      await client.connect(transport);
      return client;
    }

    if (!reg.url) throw new Error('http transport requires a url');
    const headers = authHeaders(reg.auth);
    const url = new URL(reg.url);

    if (reg.transport === 'sse') {
      const transport = new SSEClientTransport(url, {
        requestInit: { headers },
        eventSourceInit: { fetch: (u, init) => fetch(u, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers).entries()), ...headers } }) },
      });
      const client = new Client(clientInfo);
      await client.connect(transport);
      return client;
    }

    // streamable-http with automatic fallback to SSE
    try {
      const transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers },
      });
      const client = new Client(clientInfo);
      await client.connect(transport);
      return client;
    } catch (err) {
      log.warn(`streamable-http connect failed for ${reg.label}, trying SSE: ${(err as Error).message}`);
      const transport = new SSEClientTransport(url, {
        requestInit: { headers },
        eventSourceInit: { fetch: (u, init) => fetch(u, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers).entries()), ...headers } }) },
      });
      const client = new Client(clientInfo);
      await client.connect(transport);
      return client;
    }
  }

  private async getConnection(id: string): Promise<{ client: Client; reg: McpServerRegistration }> {
    const reg = await this.get(id);
    if (!reg) throw new Error(`MCP server '${id}' not found`);
    const live = this.connections.get(id);
    if (live) return { client: live.client, reg };

    // single-flight: concurrent callers share one connection attempt
    let pending = this.connecting.get(id);
    if (!pending) {
      pending = this.openClient(reg).then((client) => {
        this.connections.set(id, { client, connectedAt: Date.now() });
        return client;
      });
      this.connecting.set(id, pending);
      pending.finally(() => this.connecting.delete(id)).catch(() => {});
    }
    const client = await pending;
    return { client, reg };
  }

  async disconnect(id: string): Promise<void> {
    const live = this.connections.get(id);
    if (live) {
      this.connections.delete(id);
      try {
        await live.client.close();
      } catch { /* already closed */ }
    }
  }

  /** Connect (or reconnect), refresh the cached tool list, persist status. */
  async connect(id: string): Promise<McpServerRegistration> {
    const reg = await this.get(id);
    if (!reg) throw new Error(`MCP server '${id}' not found`);
    await this.disconnect(id);
    try {
      const client = await this.openClient(reg);
      this.connections.set(id, { client, connectedAt: Date.now() });
      const res = await client.listTools();
      reg.tools = (res.tools ?? []).map(
        (t): McpToolInfo => ({
          name: t.name,
          description: t.description,
          inputSchema: (t.inputSchema ?? undefined) as McpToolInfo['inputSchema'],
        }),
      );
      reg.status = 'connected';
      reg.lastError = undefined;
    } catch (e) {
      reg.status = 'error';
      reg.lastError = (e as Error).message;
      reg.updatedAt = nowIso();
      await this.storage.put(COLLECTIONS.mcpServers, reg.id, reg);
      throw e;
    }
    reg.updatedAt = nowIso();
    await this.storage.put(COLLECTIONS.mcpServers, reg.id, reg);
    return reg;
  }

  /** List tools (uses cache when present; connects otherwise). */
  async listTools(id: string, refresh = false): Promise<McpToolInfo[]> {
    const reg = await this.get(id);
    if (!reg) throw new Error(`MCP server '${id}' not found`);
    if (!refresh && reg.tools?.length && reg.status === 'connected') return reg.tools;
    const updated = await this.connect(id);
    return updated.tools ?? [];
  }

  /** Call a tool; returns text/structured content flattened to a JsonValue. */
  async callTool(id: string, tool: string, args: JsonObject): Promise<JsonValue> {
    const CALL_OPTS = { timeout: 300_000 }; // long-running tools; SDK default is 60s
    let connection = await this.getConnection(id);
    let result;
    try {
      result = await connection.client.callTool({ name: tool, arguments: args }, undefined, CALL_OPTS);
    } catch (e) {
      // Retry ONLY on transport/connection failures where the request never
      // reached the server — never re-execute after timeouts or tool errors
      // (the first invocation may have run server-side).
      const msg = (e as Error).message ?? '';
      const isConnectionError =
        /not connected|connection closed|transport (closed|error)|fetch failed|ECONNREFUSED|ECONNRESET|socket hang up/i.test(msg);
      if (!isConnectionError) throw e;
      await this.disconnect(id);
      connection = await this.getConnection(id);
      result = await connection.client.callTool({ name: tool, arguments: args }, undefined, CALL_OPTS);
    }

    if (result.isError) {
      const text = this.contentToValue(result.content as JsonValue);
      throw new Error(
        `MCP tool '${tool}' returned an error: ${typeof text === 'string' ? text : JSON.stringify(text)}`,
      );
    }
    if (result.structuredContent !== undefined) {
      return result.structuredContent as JsonValue;
    }
    return this.contentToValue(result.content as JsonValue);
  }

  private contentToValue(content: JsonValue): JsonValue {
    if (!Array.isArray(content)) return content ?? null;
    const parts: JsonValue[] = [];
    for (const block of content) {
      if (block && typeof block === 'object' && !Array.isArray(block)) {
        const b = block as JsonObject;
        if (b.type === 'text' && typeof b.text === 'string') {
          parts.push(b.text);
          continue;
        }
        parts.push(b);
      } else {
        parts.push(block);
      }
    }
    if (parts.length === 1) return parts[0];
    if (parts.every((p) => typeof p === 'string')) return (parts as string[]).join('\n');
    return parts;
  }

  async closeAll(): Promise<void> {
    for (const id of [...this.connections.keys()]) {
      await this.disconnect(id);
    }
  }
}
