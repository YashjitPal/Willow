/**
 * The Model Context Protocol, as much of it as a browser can speak.
 *
 * MCP is JSON-RPC 2.0 with a fixed handshake. A client connects, calls
 * `initialize`, sends `notifications/initialized`, then discovers tools with
 * `tools/list` and runs them with `tools/call`. That is the whole surface this
 * harness needs — MCP also carries resources, prompts, sampling and
 * elicitation, and none of those have a place in the Code tab yet.
 *
 * ## Why only two transports
 *
 * MCP defines stdio and Streamable HTTP. **stdio means spawning a subprocess**,
 * which a browser tab cannot do, and that is not a difficulty to engineer
 * around — it is the security boundary the browser exists to enforce. So the
 * bulk of the published ecosystem (the filesystem, git, sqlite and puppeteer
 * servers, all npm or Python packages) is unreachable from here at any price.
 *
 * What is reachable:
 *
 * 1. **Streamable HTTP**, for servers hosted at a URL — subject to the server
 *    sending CORS headers, which is a decision made at the far end and cannot
 *    be worked around from the page. `http-transport.ts`.
 * 2. **A Worker**, for servers that are plain JavaScript with no OS
 *    dependency. These run inside the tab with no network at all.
 *    `worker-transport.ts`.
 *
 * The gap between "what MCP offers" and "what these two reach" is written down
 * in [`HELPER-APP.md`](../../../../../HELPER-APP.md) at the repo root, together
 * with the other capability that wants a local process.
 *
 * ## Tool naming
 *
 * Upstream Codex flattens an MCP tool into `mcp__<server>__<tool>`
 * (`LEGACY_MCP_TOOL_NAME_PREFIX` and `MCP_TOOL_NAME_DELIMITER` in
 * `codex-rs/codex-mcp/src/tools.rs`), capped at `MAX_TOOL_NAME_LENGTH` of 128.
 * Reproduced here, because the name is what the model types and a model that
 * has seen Codex's naming elsewhere should not have to learn a second one.
 */

/* ------------------------------------------------------------------------ */
/* Naming                                                                    */
/* ------------------------------------------------------------------------ */

/** `MCP_TOOL_NAME_PREFIX`. */
export const MCP_TOOL_PREFIX = 'mcp';
/** `MCP_TOOL_NAME_DELIMITER`. */
export const MCP_TOOL_DELIMITER = '__';
/** `MAX_TOOL_NAME_LENGTH`. */
export const MAX_TOOL_NAME_LENGTH = 128;

/**
 * `mcp__<server>__<tool>`.
 *
 * Both halves are sanitised, because a server may name a tool anything and the
 * result has to survive being typed into a `*** Call:` envelope — where a
 * space or a newline would end the name early and the harness would look up
 * something the model did not mean.
 */
export function qualifiedToolName(serverId: string, toolName: string): string {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9_.-]/g, '_');
  const full = [MCP_TOOL_PREFIX, safe(serverId), safe(toolName)].join(MCP_TOOL_DELIMITER);
  return full.length <= MAX_TOOL_NAME_LENGTH ? full : full.slice(0, MAX_TOOL_NAME_LENGTH);
}

/** Splits a qualified name back into its parts, or null if it is not one. */
export function parseQualifiedToolName(
  name: string,
): { serverId: string; toolName: string } | null {
  const prefix = `${MCP_TOOL_PREFIX}${MCP_TOOL_DELIMITER}`;
  if (!name.startsWith(prefix)) return null;

  const rest = name.slice(prefix.length);
  const cut = rest.indexOf(MCP_TOOL_DELIMITER);
  if (cut <= 0) return null;

  return {
    serverId: rest.slice(0, cut),
    toolName: rest.slice(cut + MCP_TOOL_DELIMITER.length),
  };
}

export const isMcpToolName = (name: string): boolean =>
  name.startsWith(`${MCP_TOOL_PREFIX}${MCP_TOOL_DELIMITER}`);

/* ------------------------------------------------------------------------ */
/* JSON-RPC                                                                  */
/* ------------------------------------------------------------------------ */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export const isJsonRpcResponse = (message: unknown): message is JsonRpcResponse =>
  typeof message === 'object' &&
  message !== null &&
  'id' in message &&
  ('result' in message || 'error' in message);

/* ------------------------------------------------------------------------ */
/* MCP messages                                                              */
/* ------------------------------------------------------------------------ */

/**
 * The protocol revision this client asks for.
 *
 * The handshake is a *negotiation*: the server replies with the version it will
 * actually speak, which may differ. `McpClient` records what came back rather
 * than asserting this value held, so a server on an older or newer revision
 * connects instead of being rejected over a string.
 */
export const CLIENT_PROTOCOL_VERSION = '2025-06-18';

export interface InitializeResult {
  protocolVersion: string;
  capabilities?: {
    tools?: Record<string, unknown>;
    resources?: Record<string, unknown>;
    prompts?: Record<string, unknown>;
  };
  serverInfo?: { name?: string; version?: string };
  /** Some servers return standing guidance. Surfaced to the model when present. */
  instructions?: string;
}

/** One tool as the server describes it. */
export interface McpToolDescriptor {
  name: string;
  description?: string;
  /** JSON Schema. Passed through to the model as documentation, not validated. */
  inputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface ListToolsResult {
  tools: McpToolDescriptor[];
  nextCursor?: string;
}

/** One block of a tool's result. */
export type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; text?: string; mimeType?: string } }
  | { type: string; [key: string]: unknown };

export interface CallToolResult {
  content?: McpContentBlock[];
  /**
   * MCP's own failure channel.
   *
   * A tool that fails sets this rather than returning a JSON-RPC error, because
   * the failure is the tool's business and the model is expected to read it and
   * recover. Only a *protocol* fault is a JSON-RPC error.
   */
  isError?: boolean;
  structuredContent?: unknown;
}

/**
 * Renders a result for the model.
 *
 * Text blocks come through as-is. Everything else is described rather than
 * inlined: this harness has no way to show the model an image, and a
 * base64 payload in an observation is thousands of tokens the model cannot
 * use. Saying what arrived is more useful than pasting it.
 */
export function renderToolResult(result: CallToolResult): string {
  const blocks = result.content ?? [];
  if (blocks.length === 0) {
    return result.isError ? 'The tool reported an error with no detail.' : '(no output)';
  }

  return blocks
    .map((block) => {
      if (block.type === 'text') return String((block as { text?: unknown }).text ?? '');
      if (block.type === 'resource') {
        const resource = (block as { resource?: { uri?: string; text?: string } }).resource;
        return resource?.text ?? `[resource: ${resource?.uri ?? 'unknown'}]`;
      }
      const mimeType = (block as { mimeType?: string }).mimeType;
      return `[${block.type}${mimeType ? ` ${mimeType}` : ''} omitted — this harness cannot display it]`;
    })
    .join('\n')
    .trim();
}

/* ------------------------------------------------------------------------ */
/* Transport contract                                                        */
/* ------------------------------------------------------------------------ */

/**
 * What a transport owes the client.
 *
 * Deliberately small: send a message, receive messages, close. Both transports
 * here are request/response in practice, but the callback shape leaves room for
 * a server that pushes notifications without the client having to change.
 */
export interface McpTransport {
  send: (message: JsonRpcMessage) => Promise<void>;
  onMessage: (handler: (message: JsonRpcMessage) => void) => void;
  close: () => Promise<void>;
}

/* ------------------------------------------------------------------------ */
/* Errors                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Why a connection failed, in terms a user can act on.
 *
 * This exists because "failed to fetch" is what the browser gives you for a
 * CORS refusal, a DNS failure, an offline network and a blocked mixed-content
 * request alike — and those need four different sentences. The UI renders
 * `message`; `kind` decides whether we suggest a fix at all.
 */
export type McpFailureKind =
  | 'blocked-by-server'
  | 'unreachable'
  | 'insecure'
  | 'not-mcp'
  | 'protocol'
  | 'timeout'
  | 'tool-failed'
  | 'worker-failed';

export class McpError extends Error {
  constructor(
    readonly kind: McpFailureKind,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'McpError';
  }
}

/**
 * Turns a `fetch` rejection into something worth showing.
 *
 * The browser deliberately withholds the reason a cross-origin request failed,
 * so this cannot be certain — and it says so rather than guessing confidently.
 * Being honest about the ambiguity is the difference between a user checking
 * the right thing and a user rewriting a URL that was fine.
 */
export function explainFetchFailure(url: string, cause: unknown): McpError {
  const isHttp = url.startsWith('http://');
  const pageIsHttps =
    typeof globalThis.location === 'object' && globalThis.location?.protocol === 'https:';

  if (isHttp && pageIsHttps) {
    return new McpError(
      'insecure',
      'The browser blocked this request because the page is on HTTPS and the ' +
        'server address is HTTP. Use an https:// address for this server.',
      String(cause),
    );
  }

  return new McpError(
    'blocked-by-server',
    'Could not reach the server from the browser. The most common cause is that ' +
      'the server does not allow requests from a web page (CORS) — that is a ' +
      'setting on the server, not something Willow can change. It may also be ' +
      'offline or the address may be wrong.',
    String(cause),
  );
}
