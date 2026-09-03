/**
 * Worker transport — an MCP server running inside the tab.
 *
 * Some MCP servers are plain JavaScript with no dependency on the operating
 * system: they compute, or they call an API, and that is all. Those do not need
 * a machine to run on. This loads one into a Web Worker and speaks JSON-RPC to
 * it over `postMessage`, so the server and the harness live in the same page
 * with no network hop and nothing installed.
 *
 * ## Why a Worker and not just an import
 *
 * Two reasons, and the second is the one that matters. A Worker keeps the
 * server off the main thread, so a server that does something expensive cannot
 * freeze the interface. And it is a **boundary**: an MCP server is third-party
 * code, and a Worker has no DOM, no access to the page's variables, and no
 * ambient credentials. Running it inline would hand it the whole application.
 *
 * That boundary is not a sandbox — a Worker can still `fetch`. It is a floor,
 * not a guarantee, and the approval story in `mcp-store.ts` is what covers the
 * rest.
 *
 * ## What a server has to look like
 *
 * A module that listens for `message` events carrying JSON-RPC and posts
 * replies back:
 *
 * ```js
 * self.addEventListener('message', async (event) => {
 *   const request = event.data;
 *   if (request.method === 'initialize') {
 *     self.postMessage({ jsonrpc: '2.0', id: request.id, result: {
 *       protocolVersion: '2025-06-18',
 *       capabilities: { tools: {} },
 *       serverInfo: { name: 'my-server', version: '1.0.0' },
 *     }});
 *   }
 *   // …tools/list, tools/call
 * });
 * ```
 *
 * That is deliberately the raw protocol rather than a Willow-specific shape, so
 * a server written against the MCP TypeScript SDK's own worker/in-memory
 * transport works here unchanged.
 */

import { McpError, type JsonRpcMessage, type McpTransport } from './mcp-protocol';

export interface WorkerTransportOptions {
  /**
   * Where the worker module lives.
   *
   * A `blob:` URL for a pasted script, or a same-origin path for one Willow
   * ships. A cross-origin URL will not load as a module worker, which is a
   * browser rule rather than a Willow one.
   */
  moduleUrl: string;
  /** Display name, for error messages. */
  label: string;
  /** Injectable for tests, which have no `Worker`. */
  createWorker?: (moduleUrl: string) => Worker;
}

export function createWorkerTransport(options: WorkerTransportOptions): McpTransport {
  let handler: ((message: JsonRpcMessage) => void) | null = null;
  let worker: Worker | null = null;
  let failure: McpError | null = null;

  const spawn = (): Worker => {
    if (failure) throw failure;
    if (worker) return worker;

    try {
      worker =
        options.createWorker?.(options.moduleUrl) ??
        new Worker(options.moduleUrl, { type: 'module' });
    } catch (cause) {
      failure = new McpError(
        'worker-failed',
        `${options.label} could not start. The script may be invalid, or the ` +
          'browser may have refused to load it.',
        String(cause),
      );
      throw failure;
    }

    worker.addEventListener('message', (event: MessageEvent) => {
      const data = (event as MessageEvent<unknown>).data;
      if (handler && typeof data === 'object' && data !== null) {
        handler(data as JsonRpcMessage);
      }
    });

    /*
     * A worker that throws during evaluation reports here and never answers.
     *
     * Recorded rather than only logged, so the *next* send fails immediately
     * with the real reason instead of the request timing out thirty seconds
     * later with nothing to show the user.
     */
    worker.addEventListener('error', (event: ErrorEvent) => {
      failure = new McpError(
        'worker-failed',
        `${options.label} crashed: ${event.message || 'no message'}`,
        event.filename ? `${event.filename}:${event.lineno}` : undefined,
      );
    });

    return worker;
  };

  return {
    async send(message) {
      if (failure) throw failure;
      spawn().postMessage(message);
    },

    onMessage(next) {
      handler = next;
    },

    async close() {
      worker?.terminate();
      worker = null;
      handler = null;
    },
  };
}

/**
 * Wraps a pasted script as a module worker URL.
 *
 * `blob:` inherits the page's origin, so a same-origin module worker is legal
 * where a cross-origin one would not be. The caller owns revoking it — held for
 * the life of the connection, since a terminated worker may be respawned.
 */
export function scriptToModuleUrl(source: string): string {
  return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
}
