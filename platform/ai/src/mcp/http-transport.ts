/**
 * Streamable HTTP transport.
 *
 * MCP's remote transport. One endpoint; requests are POSTed as JSON-RPC and the
 * server answers with either `application/json` or an SSE stream, its choice
 * per request. A session id arrives in the `Mcp-Session-Id` response header on
 * `initialize` and is echoed on everything after.
 *
 * ## The one thing that decides whether this works
 *
 * CORS. A browser will not let a page read a cross-origin response unless the
 * server says it may, and MCP makes that stricter than usual: the protocol uses
 * custom headers (`Mcp-Session-Id`, `MCP-Protocol-Version`), so the server has
 * to allow those by name in `Access-Control-Allow-Headers` and expose
 * `Mcp-Session-Id` in `Access-Control-Expose-Headers` or the session is lost
 * after the handshake.
 *
 * **That is entirely the server operator's decision.** There is no header, flag
 * or retry on this side that changes it, which is why the error path here is as
 * carefully worded as the success path: a user who is told "connection failed"
 * will spend an hour on their URL, and a user who is told "the server does not
 * accept requests from web pages" will go and look at the server.
 *
 * Servers built for browser clients generally do send these. Servers written
 * for a desktop client generally do not, because they never needed to.
 */

import {
  explainFetchFailure,
  isJsonRpcResponse,
  McpError,
  type JsonRpcMessage,
  type McpTransport,
} from './mcp-protocol';

/** How long a single request may take before we give up on it. */
const REQUEST_TIMEOUT_MS = 30_000;

export interface HttpTransportOptions {
  url: string;
  /** Extra headers, e.g. an `Authorization` bearer for a hosted server. */
  headers?: Record<string, string>;
  /** Injectable for tests. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

export function createHttpTransport(options: HttpTransportOptions): McpTransport {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let sessionId: string | null = null;
  let protocolVersion: string | null = null;
  let handler: ((message: JsonRpcMessage) => void) | null = null;
  let closed = false;

  const headersFor = (): Record<string, string> => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      // Both, because the server picks which one to answer with per request.
      accept: 'application/json, text/event-stream',
      ...options.headers,
    };
    if (sessionId) headers['mcp-session-id'] = sessionId;
    // Sent only after the handshake settles the version — before that there is
    // nothing agreed to declare.
    if (protocolVersion) headers['mcp-protocol-version'] = protocolVersion;
    return headers;
  };

  const deliver = (message: unknown): void => {
    if (!handler || typeof message !== 'object' || message === null) return;
    handler(message as JsonRpcMessage);

    // Remember the negotiated version from the handshake so later requests can
    // declare it.
    if (isJsonRpcResponse(message) && !protocolVersion) {
      const result = message.result as { protocolVersion?: unknown } | undefined;
      if (typeof result?.protocolVersion === 'string') {
        protocolVersion = result.protocolVersion;
      }
    }
  };

  /**
   * Reads an SSE body, dispatching each `data:` payload.
   *
   * Hand-rolled rather than `EventSource`, which can only issue GETs and cannot
   * send headers — neither of which suits a transport whose requests are POSTs
   * carrying a session id.
   */
  const readEventStream = async (body: ReadableStream<Uint8Array>): Promise<void> => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (!closed) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line; a field is `name: value`.
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const data = chunk
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');

        if (data) {
          try {
            deliver(JSON.parse(data));
          } catch {
            /* A malformed event is dropped; the request's own timeout covers it. */
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  };

  return {
    async send(message) {
      if (closed) throw new McpError('protocol', 'The connection is closed.');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let response: Response;
      try {
        response = await doFetch(options.url, {
          method: 'POST',
          headers: headersFor(),
          body: JSON.stringify(message),
          signal: controller.signal,
        });
      } catch (cause) {
        clearTimeout(timer);
        if (controller.signal.aborted) {
          throw new McpError(
            'timeout',
            `The server did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds.`,
          );
        }
        throw explainFetchFailure(options.url, cause);
      }
      clearTimeout(timer);

      // Captured before the body is touched: on `initialize` this is the only
      // place the session id appears, and a server that forgets to expose the
      // header via CORS silently loses it — which surfaces later as every
      // subsequent call being rejected, so it is worth naming now.
      const returnedSession = response.headers.get('mcp-session-id');
      if (returnedSession) sessionId = returnedSession;

      if (response.status === 404 && sessionId) {
        sessionId = null;
        throw new McpError(
          'protocol',
          'The server no longer recognises this session. Reconnect to continue.',
        );
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new McpError(
          response.status === 401 || response.status === 403 ? 'blocked-by-server' : 'protocol',
          `The server answered ${response.status} ${response.statusText}.`,
          body.slice(0, 500),
        );
      }

      // A notification is answered with 202 and no body.
      if (response.status === 202) return;

      const contentType = response.headers.get('content-type') ?? '';

      if (contentType.includes('text/event-stream')) {
        if (!response.body) {
          throw new McpError('protocol', 'The server promised a stream and sent no body.');
        }
        await readEventStream(response.body);
        return;
      }

      if (!contentType.includes('application/json')) {
        // Overwhelmingly this is an HTML page — someone pasted a dashboard URL
        // rather than the MCP endpoint — so say that rather than "parse error".
        throw new McpError(
          'not-mcp',
          'That address did not answer with MCP data. Check it is the server\'s ' +
            'MCP endpoint rather than its home page or documentation.',
          contentType,
        );
      }

      const text = await response.text();
      if (text.trim() === '') return;

      try {
        const parsed = JSON.parse(text);
        // A server may batch responses into an array.
        if (Array.isArray(parsed)) parsed.forEach(deliver);
        else deliver(parsed);
      } catch (cause) {
        throw new McpError(
          'not-mcp',
          'The server\'s reply was not valid JSON-RPC.',
          `${String(cause)} — ${text.slice(0, 200)}`,
        );
      }
    },

    onMessage(next) {
      handler = next;
    },

    async close() {
      closed = true;
      if (!sessionId) return;

      // Best effort: the spec has DELETE end a session, and a server that does
      // not implement it is not a problem worth surfacing on the way out.
      try {
        await doFetch(options.url, { method: 'DELETE', headers: headersFor() });
      } catch {
        /* Ignored deliberately. */
      }
      sessionId = null;
    },
  };
}
