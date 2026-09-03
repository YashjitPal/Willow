/**
 * The MCP client: handshake, tool discovery, tool calls.
 *
 * One instance per connected server. It owns the request/response correlation
 * and the connection's lifecycle; the transport underneath only moves messages.
 *
 * ## The handshake is not optional
 *
 * `initialize`, then the `notifications/initialized` notification, then
 * anything else. A server is entitled to reject `tools/list` before that
 * sequence completes, and several do. `connect()` therefore does all three and
 * either returns a working client or throws — there is no half-connected state
 * for a caller to get wrong.
 *
 * ## Every failure has a sentence
 *
 * This file exists as much for its error paths as its success path. A user
 * adding an MCP server in a browser will hit CORS refusals, wrong URLs, and
 * servers that speak a protocol version we did not ask for, and the browser
 * reports most of those identically as "failed to fetch". Each one gets a
 * distinct `McpError` with wording aimed at the person who has to fix it.
 */

import {
  CLIENT_PROTOCOL_VERSION,
  isJsonRpcResponse,
  McpError,
  renderToolResult,
  type CallToolResult,
  type InitializeResult,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type ListToolsResult,
  type McpToolDescriptor,
  type McpTransport,
} from './mcp-protocol';

/** How long one request waits for its answer. */
const CALL_TIMEOUT_MS = 60_000;
/** A guard on `tools/list` paging, so a server cannot loop us forever. */
const MAX_TOOL_PAGES = 20;

interface Pending {
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class McpClient {
  private nextId = 1;
  private readonly pending = new Map<number | string, Pending>();
  private closed = false;

  /** What the server said it is. Populated by `connect`. */
  serverInfo: InitializeResult['serverInfo'];
  /** The version actually agreed, which may not be what we asked for. */
  negotiatedVersion = '';
  /** Standing guidance some servers return from `initialize`. */
  instructions?: string;

  private constructor(
    readonly serverId: string,
    private readonly transport: McpTransport,
  ) {
    transport.onMessage((message) => this.receive(message));
  }

  /**
   * Connects and completes the handshake.
   *
   * Throws `McpError` on every failure path, so a caller has one thing to
   * catch and the UI has one thing to render.
   */
  static async connect(serverId: string, transport: McpTransport): Promise<McpClient> {
    const client = new McpClient(serverId, transport);

    let initialized: InitializeResult;
    try {
      initialized = (await client.request('initialize', {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        // Honest about what we support: tools only. Declaring capabilities we
        // do not implement invites a server to use them.
        capabilities: {},
        clientInfo: { name: 'willow-code-agent', version: '1.0.0' },
      })) as InitializeResult;
    } catch (error) {
      await transport.close().catch(() => {});
      throw error;
    }

    if (typeof initialized?.protocolVersion !== 'string') {
      await transport.close().catch(() => {});
      throw new McpError(
        'not-mcp',
        'That address answered, but not with an MCP handshake. Check it is the ' +
          "server's MCP endpoint.",
      );
    }

    client.negotiatedVersion = initialized.protocolVersion;
    client.serverInfo = initialized.serverInfo;
    client.instructions = initialized.instructions;

    /*
     * The notification the spec requires before normal operation.
     *
     * Sent without waiting: it is a notification, so there is no reply to wait
     * for, and a transport that rejects it (an over-strict proxy, say) should
     * not sink a connection that is otherwise fine.
     */
    try {
      await transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    } catch {
      /* Deliberately ignored — see above. */
    }

    return client;
  }

  /** Every tool the server offers, following `nextCursor` to the end. */
  async listTools(): Promise<McpToolDescriptor[]> {
    const tools: McpToolDescriptor[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
      const result = (await this.request(
        'tools/list',
        cursor ? { cursor } : {},
      )) as ListToolsResult;

      for (const tool of result?.tools ?? []) {
        if (typeof tool?.name === 'string' && tool.name !== '') tools.push(tool);
      }

      cursor = result?.nextCursor;
      if (!cursor) return tools;
    }

    // Hit the page guard. Return what we have rather than throwing — a partial
    // tool list is usable, and an unbounded loop is not.
    return tools;
  }

  /**
   * Runs a tool.
   *
   * Returns the rendered text either way. An MCP tool failure is `isError` on a
   * *successful* response, not a JSON-RPC error, because the failure is the
   * tool's business and the model is meant to read it and recover — the same
   * shape the rest of this harness uses for every tool.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ text: string; failed: boolean }> {
    const result = (await this.request('tools/call', {
      name,
      arguments: args ?? {},
    })) as CallToolResult;

    return { text: renderToolResult(result ?? {}), failed: result?.isError === true };
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new McpError('protocol', 'The connection was closed.'));
      this.pending.delete(id);
    }
    await this.transport.close().catch(() => {});
  }

  /* -------------------------------------------------------------------- */

  private request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new McpError('protocol', 'The connection is closed.'));
    }

    const id = this.nextId++;
    const message: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new McpError(
            'timeout',
            `The server did not answer \`${method}\` within ${CALL_TIMEOUT_MS / 1000} seconds.`,
          ),
        );
      }, CALL_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });

      /*
       * `send` can reject *and* the reply can still never come, so the pending
       * entry is cleared here rather than left for the timeout. Without this a
       * transport error would resolve the caller immediately and then fire a
       * second rejection thirty seconds later against nothing.
       */
      this.transport.send(message).catch((error) => {
        const entry = this.pending.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private receive(message: JsonRpcMessage): void {
    if (!isJsonRpcResponse(message)) return;

    const entry = this.pending.get(message.id);
    if (!entry) return;

    clearTimeout(entry.timer);
    this.pending.delete(message.id);

    if (message.error) {
      entry.reject(
        new McpError(
          'protocol',
          message.error.message || `The server returned error ${message.error.code}.`,
          message.error.data === undefined ? undefined : JSON.stringify(message.error.data),
        ),
      );
      return;
    }

    entry.resolve(message.result);
  }
}
