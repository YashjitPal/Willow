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
import { createProgramTransport, type McpProgramHost } from './program-transport';
import { McpClient } from './mcp-client';
import { grantExpired, refreshGrant, signIn, type McpOAuthGrant } from './mcp-oauth';
import { McpError, qualifiedToolName, type McpToolDescriptor } from './mcp-protocol';

/**
 * How a server is reached: at an address, as a script in the tab, or — in the desktop app — as a program on this
 * computer, which Willow's companion runs. See `mcp-protocol.ts`.
 */
export type McpServerKind = 'http' | 'worker' | 'program';

export interface McpServerConfig {
  /** Stable id. Becomes the middle of `mcp__<id>__<tool>`, so it stays short. */
  id: string;
  label: string;
  kind: McpServerKind;
  /** For `http`. The server's MCP endpoint. */
  url?: string;
  /** For `http`. Sent on every request; where a bearer token goes. */
  headers?: Record<string, string>;
  /** For `http`. A server the user signed in to (`mcp-oauth.ts`): its tokens, refreshed as they run out. */
  oauth?: McpOAuthGrant;
  /** For `worker`. The module source, stored verbatim. */
  script?: string;
  /** For `program`. What starts it, as the user typed it, split into the program and its arguments. */
  command?: string;
  args?: string[];
  /** For `program`. Variables it reads, such as a key; over this computer's own. */
  env?: Record<string, string>;
  /** For `program`. The folder it starts in; the user's home when unset. */
  cwd?: string;
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

/**
 * How `http` servers are fetched. A web page reaches only servers that allow it (CORS), and most MCP servers were
 * written for desktop clients that never needed to; the desktop app sets this to go through Willow's companion,
 * which any server answers. Unset, the window's own `fetch`.
 */
let mcpFetch: typeof fetch | undefined;

export function setMcpFetch(fetchImpl: typeof fetch | undefined): void {
  mcpFetch = fetchImpl;
}

/** What runs `program` servers: the desktop app's companion. Unset, there is nothing that can. */
let programHost: McpProgramHost | undefined;

export function setMcpProgramHost(host: McpProgramHost | undefined): void {
  programHost = host;
}

/** When each `program` server was last started again after ending on its own, so one that keeps dying is left failed. */
const restarted = new Map<string, number>();
const RESTART_AFTER_MS = 60_000;

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

/**
 * The whole list at once (`settings.json`). A server that went or changed is disconnected; one
 * still enabled connects again the next time servers are connected, as at startup.
 */
export async function replaceMcpServers(next: McpServerConfig[]): Promise<void> {
  const before = mcpServers.get();
  mcpServers.set(next);
  persist(next);
  for (const server of before) {
    const now = next.find((entry) => entry.id === server.id);
    if (!now || JSON.stringify(now) !== JSON.stringify(server)) await disconnectMcpServer(server.id);
  }
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
  let connected: McpClient | undefined;

  try {
    let transport;
    if (server.kind === 'http') {
      if (!server.url) throw new McpError('protocol', 'This server has no address.');
      transport = createHttpTransport({ url: server.url, headers: server.headers, ...(mcpFetch ? { fetchImpl: mcpFetch } : {}), ...(server.oauth ? { auth: signedIn(server.id) } : {}) });
    } else if (server.kind === 'program') {
      if (!server.command?.trim()) throw new McpError('program-failed', 'This server has no command.');
      if (!programHost) throw new McpError('program-failed', 'Programs on this computer run in the Willow desktop app.');
      transport = createProgramTransport({
        id: `${server.id}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        label: server.label,
        spec: { command: server.command, args: server.args ?? [], ...(server.env ? { env: server.env } : {}), ...(server.cwd ? { cwd: server.cwd } : {}) },
        host: programHost,
      });
    } else {
      if (!server.script?.trim()) throw new McpError('worker-failed', 'This server has no script.');
      objectUrl = scriptToModuleUrl(server.script);
      transport = createWorkerTransport({ moduleUrl: objectUrl, label: server.label });
    }

    const client = await McpClient.connect(server.id, transport);
    connected = client;
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

    // A program that ends after connecting: shown as failed, and started again once while it is on — not twice a minute.
    transport.onFailure?.((error) => {
      if (mcpRuntime.get()[id]?.client !== client) return;
      void client.close();
      mcpRuntime.setKey(id, { status: { state: 'failed', message: error.message, detail: error.detail, kind: error.kind }, tools: [] });
      const last = restarted.get(id) ?? 0;
      if (Date.now() - last < RESTART_AFTER_MS || !mcpServers.get().find((entry) => entry.id === id)?.enabled) return;
      restarted.set(id, Date.now());
      void connectMcpServer(id);
    });
  } catch (error) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    await connected?.close().catch(() => {});

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

/**
 * The tokens of a server the user signed in to, for its transport: the current access token — refreshed first once
 * it has run out — and a fresh one when the server refuses the current. A refreshed grant is kept, the rotated
 * refresh token with it; two requests needing one at once share a single refresh.
 */
function signedIn(id: string): { token: () => Promise<string | null>; refresh: () => Promise<string | null> } {
  let refreshing: Promise<string | null> | null = null;
  const current = () => mcpServers.get().find((entry) => entry.id === id)?.oauth;
  const refresh = (): Promise<string | null> => {
    refreshing ??= (async () => {
      const grant = current();
      if (!grant?.refreshToken) return null;
      try {
        const next = await refreshGrant(grant, mcpFetch ?? globalThis.fetch.bind(globalThis));
        const server = mcpServers.get().find((entry) => entry.id === id);
        if (server) upsertMcpServer({ ...server, oauth: next });
        return next.accessToken;
      } catch {
        return null;
      }
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  };
  return {
    token: async () => {
      const grant = current();
      if (!grant) return null;
      return grantExpired(grant) ? (await refresh()) ?? grant.accessToken : grant.accessToken;
    },
    refresh,
  };
}

/**
 * Signs in to an `http` server and connects it. The host supplies the address the sign-in page sends the user back
 * to and the way to show that page and catch the answer (the desktop app: the companion's loopback, `mcp-signin.ts`);
 * `client` is the user's own app, for services that do not let apps register themselves. Throws what went wrong as a
 * sentence (`McpOAuthError`).
 */
export async function signInMcpServer(config: McpServerConfig, host: {
  redirectUri: string;
  openAndWait: (url: string) => Promise<{ code?: string; state?: string; error?: string; errorDescription?: string }>;
  client?: { clientId: string; clientSecret?: string };
}): Promise<void> {
  if (config.kind !== 'http' || !config.url) throw new McpError('protocol', 'Only a server at a web address can be signed in to.');
  const grant = await signIn({
    serverUrl: config.url,
    fetchImpl: mcpFetch ?? globalThis.fetch.bind(globalThis),
    clientName: 'Willow',
    redirectUri: host.redirectUri,
    ...(host.client ? { client: host.client } : {}),
    openAndWait: host.openAndWait,
  });
  // A key typed in earlier is what the sign-in replaces.
  const headers = Object.fromEntries(Object.entries(config.headers ?? {}).filter(([name]) => name.toLowerCase() !== 'authorization'));
  upsertMcpServer({ ...config, headers: Object.keys(headers).length ? headers : undefined, enabled: true, oauth: grant });
  await connectMcpServer(config.id);
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
export function suggestMcpServerId(label: string, reserved: Iterable<string> = []): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'server';

  const taken = new Set([...mcpServers.get().map((server) => server.id), ...reserved]);
  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
