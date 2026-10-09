/**
 * MCP servers' HTTP through Willow's companion (`relay.http`), for the desktop app.
 *
 * A web page reaches only the servers that allow it (CORS), and most MCP servers were written for desktop clients
 * that never needed to — so through the window, most of them fail at the handshake. The companion asks on the
 * window's behalf, and answers in the shape `fetch` returns. When the companion cannot be reached, the window's own
 * `fetch` is tried, so a server that does allow pages still works.
 *
 * Servers that are programs on this computer run there too (`mcp.start`, `mcp.send`, `mcp.stop`; their output comes
 * back as `mcp.message` and their end as `mcp.exit`), which a page cannot do at all.
 */
import { setMcpFetch, setMcpProgramHost } from '@willow/ai/mcp/mcp-store';
import type { McpProgramExit, McpProgramHost } from '@willow/ai/mcp/program-transport';
import type { JsonRpcMessage } from '@willow/ai/mcp/mcp-protocol';
import { isDesktopApp } from '@willow/core/desktop-bridge';

interface RelayReply {
  status: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
}

const companion = () => import('@willow/code/local-companion').then((module) => module.localCompanion);

const UNREACHABLE = /not running|unavailable|disconnected|timed out|Unknown companion request/i;

export const companionFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    headers[key] = value;
  });
  let reply: RelayReply;
  try {
    const client = await companion();
    reply = await client.request<RelayReply>('relay.http', { url, method: init?.method ?? 'GET', headers, ...(typeof init?.body === 'string' ? { body: init.body } : {}) }, 75_000);
  } catch (error) {
    if (UNREACHABLE.test(error instanceof Error ? error.message : String(error))) return fetch(input, init);
    throw error instanceof Error ? error : new Error(String(error));
  }
  const empty = reply.status === 204 || reply.status === 205 || reply.status === 304;
  return new Response(empty ? null : reply.body ?? '', { status: reply.status, statusText: reply.statusText ?? '', headers: reply.headers ?? {} });
};

export const companionPrograms: McpProgramHost = {
  start: async (id, spec) => {
    await (await companion()).request('mcp.start', { id, ...spec }, 120_000);
  },
  send: async (id, message) => {
    await (await companion()).request('mcp.send', { id, message }, 30_000);
  },
  stop: async (id) => {
    await (await companion()).request('mcp.stop', { id }, 10_000);
  },
  listen: (id, on) => {
    let off = (): void => undefined;
    let gone = false;
    void companion().then((client) => {
      if (gone) return;
      off = client.onMessage((message) => {
        if (message.type !== 'event' || (message.payload as { id?: unknown } | undefined)?.id !== id) return;
        if (message.event === 'mcp.message') on.message((message.payload as { message: JsonRpcMessage }).message);
        else if (message.event === 'mcp.exit') on.exit(message.payload as McpProgramExit);
      });
    });
    return () => {
      gone = true;
      off();
    };
  },
};

/** Whether this window can run MCP servers that are programs on this computer: the desktop app, with a companion that does. */
export const canRunPrograms = async (): Promise<boolean> => {
  if (!isDesktopApp()) return false;
  try {
    const client = await companion();
    return (await client.connect(1_500)) && client.capabilities.includes('mcp-programs');
  } catch {
    return false;
  }
};

if (isDesktopApp()) {
  setMcpFetch(companionFetch);
  setMcpProgramHost(companionPrograms);
}
