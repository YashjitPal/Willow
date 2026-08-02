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
import { sanitizeTraceValue } from '../engine/traceData.ts';
import { DEFAULT_SUBJECT_ID, DEFAULT_WORKSPACE_ID, type AuthPrincipal } from '../services/governance.ts';
import { assertSafeOutboundUrl } from '../http/outboundUrl.ts';

const log = createLogger('mcp');

export function sanitizeMcpError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return String(sanitizeTraceValue(message
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, 'https://[REDACTED]@')
    .replace(/([?&](?:access_token|api_key|key|token|secret|password)=)[^&\s]+/gi, '$1[REDACTED]')));
}

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

export type McpAccess = Pick<AuthPrincipal, 'subjectId' | 'workspaceId' | 'role'> & Partial<Pick<AuthPrincipal, 'authority'>>;

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

/** MCP listTools is cursor-paginated; collect every page during discovery. */
async function listAllTools(client: Client): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
  const tools: Array<{ name: string; description?: string; inputSchema?: unknown }> = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...(page.tools ?? []));
    const next = page.nextCursor;
    if (!next) break;
    if (seen.has(next)) {
      throw new Error(`MCP tool discovery returned a repeated cursor '${next}'`);
    }
    seen.add(next);
    cursor = next;
  } while (true);
  return tools;
}

type McpFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function createSafeMcpFetch(
  allowPrivateNetworks = false,
  transport: McpFetch = globalThis.fetch,
): McpFetch {
  return async (input, init) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const safeUrl = await assertSafeOutboundUrl(rawUrl, allowPrivateNetworks);
    // MCP credentials and configured headers must never follow a redirect to a
    // different destination. The SDK treats a redirect error as a transport failure.
    return transport(safeUrl, { ...init, redirect: 'error' });
  };
}

export class McpManager {
  private connections = new Map<string, LiveConnection>();
  /** Single-flight guard: in-progress connection attempts by server id. */
  private connecting = new Map<string, Promise<Client>>();
  /** Invalidates connection attempts that finish after a disconnect/update/remove. */
  private connectionGenerations = new Map<string, number>();
  private storage: Storage;
  private allowPrivateNetworks: boolean;

  constructor(storage: Storage, options: { allowPrivateNetworks?: boolean } = {}) {
    this.storage = storage;
    this.allowPrivateNetworks = options.allowPrivateNetworks ?? false;
  }

  private normalizeOwnership(registration: McpServerRegistration): McpServerRegistration {
    registration.ownerId ??= DEFAULT_SUBJECT_ID;
    registration.workspaceId ??= DEFAULT_WORKSPACE_ID;
    return registration;
  }

  private canAccess(registration: McpServerRegistration, access?: McpAccess): boolean {
    if (!access || access.authority === 'platform') return true;
    const normalized = this.normalizeOwnership(registration);
    return normalized.workspaceId === access.workspaceId
      && (access.role === 'admin' || normalized.ownerId === access.subjectId);
  }

  // ---------------- registry ----------------

  async register(input: RegisterServerInput, access?: McpAccess): Promise<McpServerRegistration> {
    if (!input.url && !input.command) {
      throw new Error('MCP server requires a url (http/sse) or command (stdio)');
    }
    const reg: McpServerRegistration = {
      id: ids.mcpServer(),
      ownerId: access?.subjectId ?? DEFAULT_SUBJECT_ID,
      workspaceId: access?.workspaceId ?? DEFAULT_WORKSPACE_ID,
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
    access?: McpAccess,
  ): Promise<McpServerRegistration | undefined> {
    const reg = await this.get(id, access);
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

  async get(id: string, access?: McpAccess): Promise<McpServerRegistration | undefined> {
    const registration = await this.storage.get<McpServerRegistration>(COLLECTIONS.mcpServers, id);
    if (!registration) return undefined;
    const normalized = this.normalizeOwnership(registration);
    return this.canAccess(normalized, access) ? normalized : undefined;
  }

  async list(access?: McpAccess): Promise<McpServerRegistration[]> {
    const rows = await this.storage.list<McpServerRegistration>(COLLECTIONS.mcpServers);
    return rows.map((row) => this.normalizeOwnership(row.doc)).filter((registration) => this.canAccess(registration, access));
  }

  async remove(id: string, access?: McpAccess): Promise<boolean> {
    if (!await this.get(id, access)) return false;
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
    const url = await assertSafeOutboundUrl(reg.url, this.allowPrivateNetworks);
    const safeFetch = createSafeMcpFetch(this.allowPrivateNetworks);

    if (reg.transport === 'sse') {
      const transport = new SSEClientTransport(url, {
        requestInit: { headers },
        fetch: safeFetch,
      });
      const client = new Client(clientInfo);
      await client.connect(transport);
      return client;
    }

    // streamable-http with automatic fallback to SSE
    try {
      const transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers },
        fetch: safeFetch,
      });
      const client = new Client(clientInfo);
      await client.connect(transport);
      return client;
    } catch (err) {
      log.warn(`streamable-http connect failed for ${reg.label}, trying SSE: ${(err as Error).message}`);
      const transport = new SSEClientTransport(url, {
        requestInit: { headers },
        fetch: safeFetch,
      });
      const client = new Client(clientInfo);
      await client.connect(transport);
      return client;
    }
  }

  private async getConnection(id: string, access?: McpAccess): Promise<{ client: Client; reg: McpServerRegistration }> {
    const reg = await this.get(id, access);
    if (!reg) throw new Error(`MCP server '${id}' not found`);
    const live = this.connections.get(id);
    if (live) return { client: live.client, reg };

    // single-flight: concurrent callers share one connection attempt
    let pending = this.connecting.get(id);
    if (!pending) {
      const generation = this.connectionGenerations.get(id) ?? 0;
      pending = this.openClient(reg).then(async (client) => {
        if ((this.connectionGenerations.get(id) ?? 0) !== generation) {
          try {
            await client.close();
          } catch { /* connection was already closed */ }
          throw new Error(`MCP connection for '${id}' was superseded`);
        }
        this.connections.set(id, { client, connectedAt: Date.now() });
        return client;
      });
      this.connecting.set(id, pending);
      pending.finally(() => {
        if (this.connecting.get(id) === pending) this.connecting.delete(id);
      }).catch(() => {});
    }
    const client = await pending;
    return { client, reg };
  }

  async disconnect(id: string): Promise<void> {
    this.connectionGenerations.set(id, (this.connectionGenerations.get(id) ?? 0) + 1);
    this.connecting.delete(id);
    const live = this.connections.get(id);
    if (live) {
      this.connections.delete(id);
      try {
        await live.client.close();
      } catch { /* already closed */ }
    }
  }

  /** Connect (or reconnect), refresh the cached tool list, persist status. */
  async connect(id: string, access?: McpAccess): Promise<McpServerRegistration> {
    const reg = await this.get(id, access);
    if (!reg) throw new Error(`MCP server '${id}' not found`);
    await this.disconnect(id);
    const generation = this.connectionGenerations.get(id) ?? 0;
    let client: Client | undefined;
    try {
      client = await this.openClient(reg);
      if ((this.connectionGenerations.get(id) ?? 0) !== generation) {
        try {
          await client.close();
        } catch { /* connection was already closed */ }
        throw new Error(`MCP connection for '${id}' was superseded`);
      }
      this.connections.set(id, { client, connectedAt: Date.now() });
      const discoveredTools = await listAllTools(client);
      if ((this.connectionGenerations.get(id) ?? 0) !== generation) {
        await this.disconnect(id);
        throw new Error(`MCP connection for '${id}' was superseded`);
      }
      reg.tools = discoveredTools.map(
        (t): McpToolInfo => ({
          name: t.name,
          description: t.description,
          inputSchema: (t.inputSchema ?? undefined) as McpToolInfo['inputSchema'],
        }),
      );
      reg.status = 'connected';
      reg.lastError = undefined;
    } catch (e) {
      if ((this.connectionGenerations.get(id) ?? 0) !== generation) throw e;
      if (this.connections.get(id)?.client === client) this.connections.delete(id);
      if (client) {
        try {
          await client.close();
        } catch { /* failed discovery connections are never reused */ }
      }
      reg.status = 'error';
      reg.lastError = sanitizeMcpError(e);
      reg.updatedAt = nowIso();
      await this.storage.put(COLLECTIONS.mcpServers, reg.id, reg);
      throw e;
    }
    reg.updatedAt = nowIso();
    await this.storage.put(COLLECTIONS.mcpServers, reg.id, reg);
    return reg;
  }

  /** List tools (uses cache when present; connects otherwise). */
  async listTools(id: string, refresh = false, access?: McpAccess): Promise<McpToolInfo[]> {
    const reg = await this.get(id, access);
    if (!reg) throw new Error(`MCP server '${id}' not found`);
    if (!refresh && reg.tools?.length && reg.status === 'connected') return reg.tools;
    const updated = await this.connect(id, access);
    return updated.tools ?? [];
  }

  /** Call a tool; returns text/structured content flattened to a JsonValue. */
  async callTool(
    id: string,
    tool: string,
    args: JsonObject,
    options: { signal?: AbortSignal; timeoutMs?: number; retryTransport?: boolean; access?: McpAccess } = {},
  ): Promise<JsonValue> {
    const timeoutMs = options.timeoutMs ?? 300_000;
    // The SDK timeout is advisory and transports differ in how they enforce it.
    // Create an explicit abort signal so direct MCP calls have deterministic
    // cancellation even when they are not wrapped by the engine policy layer.
    const timeoutController = new AbortController();
    const timer = timeoutMs > 0
      ? setTimeout(() => timeoutController.abort(new Error(`MCP tool '${tool}' timed out after ${timeoutMs}ms`)), timeoutMs)
      : undefined;
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutController.signal])
      : timeoutController.signal;
    const callOptions = { timeout: timeoutMs, signal };
    let connection: Awaited<ReturnType<McpManager['getConnection']>>;
    let result;
    try {
      connection = await this.getConnection(id, options.access);
      result = await connection.client.callTool({ name: tool, arguments: args }, undefined, callOptions);
    } catch (e) {
      // Retry ONLY on transport/connection failures where the request never
      // reached the server — never re-execute after timeouts or tool errors
      // (the first invocation may have run server-side).
      const msg = (e as Error).message ?? '';
      const isConnectionError =
        /not connected|connection closed|transport (closed|error)|fetch failed|ECONNREFUSED|ECONNRESET|socket hang up/i.test(msg);
      if (!isConnectionError || options.retryTransport === false || options.signal?.aborted) throw e;
      await this.disconnect(id);
      connection = await this.getConnection(id, options.access);
      result = await connection.client.callTool({ name: tool, arguments: args }, undefined, callOptions);
      if (result.isError) {
        const text = this.contentToValue(result.content as JsonValue);
        throw new Error(
          `MCP tool '${tool}' returned an error: ${typeof text === 'string' ? text : JSON.stringify(text)}`,
        );
      }
      if (result.structuredContent !== undefined) return result.structuredContent as JsonValue;
      return this.contentToValue(result.content as JsonValue);
    } finally {
      if (timer) clearTimeout(timer);
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
    const ids = new Set([...this.connections.keys(), ...this.connecting.keys()]);
    for (const id of ids) {
      await this.disconnect(id);
    }
  }
}
