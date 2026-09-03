/**
 * Configured MCP servers, their connection state, and their tools.
 *
 * One store, read by the settings UI and by the turn loop. Connections are held
 * open for the session: the handshake costs a round trip and a `tools/list`, so
 * reconnecting per turn would add seconds to every message.
 *
 * ## Approval is part of this, not a later feature
 *
 * An MCP server is third-party code, and what it returns is text the model
 * reads and acts on — which makes it a prompt-injection surface. Upstream Codex
 * gates this behind an approval layer for exactly that reason.
 *
 * So a server here is `enabled: false` until the user turns it on, and turning
 * it on is a deliberate act in settings rather than a side effect of pasting a
 * URL. That is the whole of the approval story at this stage, and it is
 * deliberately coarse: per-tool approval is worth having, and pretending a
 * half-built version of it is protection would be worse than one clear switch.
 */

import { atom, map } from 'nanostores';
import { createHttpTransport } from './http-transport';
import { createWorkerTransport, scriptToModuleUrl } from './worker-transport';
import { McpClient } from './mcp-client';
import { McpError, qualifiedToolName, type McpToolDescriptor } from './mcp-protocol';

/**
 * How a server is reached.
 *
 * Two kinds, because two are what a browser can do. See `mcp-protocol.ts` for
 * why, and `HELPER-APP.md` for what the third would take.
 */
export type McpServerKind = 'http' | 'worker';

export interface McpServerConfig {
  /** Stable id. Becomes the middle of `mcp__<id>__<tool>`, so it stays short. */
  id: string;
  label: string;
  kind: McpServerKind;
  /** For `http`. The server's MCP endpoint. */
  url?: string;
  /** For `http`. Sent on every request; where a bearer token goes. */
  headers?: Record<string, string>;
  /** For `worker`. The module source, stored verbatim. */
  script?: string;
  /** Off until the user turns it on. See the note above. */
  enabled: boolean;
}

export type McpStatus =
  | { state: 'idle' }
  | { state: 'connecting' }
  | { state: 'ready'; toolCount: number; serverName?: string; version?: string }
  | { state: 'failed'; message: string; detail?: string; kind: string };

export interface McpRuntimeEntry {
  status: McpStatus;
  tools: McpToolDescriptor[];
  client?: McpClient;
  /** Held so it can be revoked when a worker server is removed. */
  objectUrl?: string;
}

const STORAGE_KEY = 'willow:code:mcp-servers';

function readStored(): McpServerConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as McpServerConfig[]) : [];
  } catch {
    return [];
  }
}

export const mcpServers = atom<McpServerConfig[]>(readStored());

/** Connection state per server id. Never persisted — it describes right now. */
export const mcpRuntime = map<Record<string, McpRuntimeEntry>>({});

function persist(servers: McpServerConfig[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
  } catch {
    /* Private mode; the session still works, it just will not be remembered. */
  }
}

export function upsertMcpServer(config: McpServerConfig): void {
  const next = mcpServers.get().slice();
  const at = next.findIndex((server) => server.id === config.id);
  if (at === -1) next.push(config);
  else next[at] = config;
  mcpServers.set(next);
  persist(next);
}

export async function removeMcpServer(id: string): Promise<void> {
  await disconnectMcpServer(id);
  const next = mcpServers.get().filter((server) => server.id !== id);
  mcpServers.set(next);
  persist(next);
}

export async function setMcpServerEnabled(id: string, enabled: boolean): Promise<void> {
  const server = mcpServers.get().find((entry) => entry.id === id);
  if (!server) return;

  upsertMcpServer({ ...server, enabled });
  if (enabled) await connectMcpServer(id);
  else await disconnectMcpServer(id);
}

/* ------------------------------------------------------------------------ */
/* Connecting                                                               */
/* ------------------------------------------------------------------------ */

const setStatus = (id: string, status: McpStatus): void => {
  const current = mcpRuntime.get()[id];
  mcpRuntime.setKey(id, { tools: [], ...current, status });
};

/**
 * Connects one server and lists its tools.
 *
 * Never throws. Every failure lands in `status` as a sentence, because the only
 * consumer is a settings panel that has to show something useful — and a
 * rejected promise here would either be swallowed or crash a click handler.
 */
export async function connectMcpServer(id: string): Promise<void> {
  const server = mcpServers.get().find((entry) => entry.id === id);
  if (!server) return;

  await disconnectMcpServer(id);
  setStatus(id, { state: 'connecting' });

  let objectUrl: string | undefined;

  try {
    let transport;
    if (server.kind === 'http') {
      if (!server.url) throw new McpError('protocol', 'This server has no address.');
      transport = createHttpTransport({ url: server.url, headers: server.headers });
    } else {
      if (!server.script?.trim()) throw new McpError('worker-failed', 'This server has no script.');
      objectUrl = scriptToModuleUrl(server.script);
      transport = createWorkerTransport({ moduleUrl: objectUrl, label: server.label });
    }

    const client = await McpClient.connect(server.id, transport);
    const tools = await client.listTools();

    mcpRuntime.setKey(id, {
      status: {
        state: 'ready',
        toolCount: tools.length,
        serverName: client.serverInfo?.name,
        version: client.negotiatedVersion,
      },
      tools,
      client,
      objectUrl,
    });
  } catch (error) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);

    const failure =
      error instanceof McpError
        ? error
        : new McpError('protocol', (error as Error)?.message || 'The connection failed.');

    mcpRuntime.setKey(id, {
      status: {
        state: 'failed',
        message: failure.message,
        detail: failure.detail,
        kind: failure.kind,
      },
      tools: [],
    });
  }
}

export async function disconnectMcpServer(id: string): Promise<void> {
  const entry = mcpRuntime.get()[id];
  if (!entry) return;

  await entry.client?.close().catch(() => {});
  if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  mcpRuntime.setKey(id, { status: { state: 'idle' }, tools: [] });
}

/**
 * Connects everything the user has enabled but which is not up yet.
 *
 * Called when the workbench mounts. Config survives a reload and connections do
 * not, so without this a user who enabled a server yesterday would get none of
 * its tools today.
 *
 * Skips anything not `idle`, which is what makes it safe to call more than
 * once: a live server is left alone, and a failed one keeps its message rather
 * than being retried into the same failure on every mount.
 */
export async function connectEnabledMcpServers(): Promise<void> {
  const runtime = mcpRuntime.get();

  await Promise.all(
    mcpServers
      .get()
      .filter((server) => {
        if (!server.enabled) return false;
        const state = runtime[server.id]?.status.state;
        return state === undefined || state === 'idle';
      })
      .map((server) => connectMcpServer(server.id)),
  );
}

/* ------------------------------------------------------------------------ */
/* What a turn gets                                                         */
/* ------------------------------------------------------------------------ */

/** One MCP tool, flattened for the harness. */
export interface McpBoundTool {
  /** `mcp__<server>__<tool>`. */
  qualifiedName: string;
  /** The name the server knows it by. */
  toolName: string;
  serverId: string;
  serverLabel: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  client: McpClient;
}

/**
 * Every tool from every connected, enabled server.
 *
 * A snapshot, read once per turn — the same reason the skills catalog is a
 * snapshot. The tool list goes into the system prompt, so a server connecting
 * or dropping mid-turn would leave the model holding a list that no longer
 * matches what it can call.
 */
export function boundMcpTools(): McpBoundTool[] {
  const runtime = mcpRuntime.get();
  const bound: McpBoundTool[] = [];

  for (const server of mcpServers.get()) {
    if (!server.enabled) continue;
    const entry = runtime[server.id];
    if (!entry?.client || entry.status.state !== 'ready') continue;

    for (const tool of entry.tools) {
      bound.push({
        qualifiedName: qualifiedToolName(server.id, tool.name),
        toolName: tool.name,
        serverId: server.id,
        serverLabel: server.label,
        description: tool.description,
        inputSchema: tool.inputSchema,
        client: entry.client,
      });
    }
  }

  return bound;
}

/** A fresh id from a label, unique against what is already configured. */
export function suggestMcpServerId(label: string): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'server';

  const taken = new Set(mcpServers.get().map((server) => server.id));
  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
