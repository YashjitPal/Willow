/**
 * Program transport — an MCP server that is a program on this computer (MCP's stdio), run by Willow's companion in
 * the desktop app (`services/local-companion/src/mcp-programs.mjs`). The window holds no process: it hands each
 * message to the companion and hears the program's back, and its end.
 *
 * Each connection is its own program under its own id, so a reconnect never hears the last one's late messages.
 */

import { McpError, type JsonRpcMessage, type McpTransport } from './mcp-protocol';

export interface McpProgramSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpProgramExit {
  code: number | null;
  signal: string | null;
  stderr: string;
}

/** What runs programs: the desktop app's companion (`features/spark/src/mcp-relay.ts`). */
export interface McpProgramHost {
  start: (id: string, spec: McpProgramSpec) => Promise<void>;
  send: (id: string, message: JsonRpcMessage) => Promise<void>;
  stop: (id: string) => Promise<void>;
  /** The program's messages and its end, until the returned function is called. */
  listen: (id: string, on: { message: (message: JsonRpcMessage) => void; exit: (end: McpProgramExit) => void }) => () => void;
}

export interface ProgramTransportOptions {
  id: string;
  /** Display name, for error messages. */
  label: string;
  spec: McpProgramSpec;
  host: McpProgramHost;
}

const ended = (label: string, { code, signal }: McpProgramExit): string =>
  `${label} stopped${typeof code === 'number' ? ` (exit code ${code})` : signal ? ` (${signal})` : ''}.`;

export function createProgramTransport({ id, label, spec, host }: ProgramTransportOptions): McpTransport {
  let handler: ((message: JsonRpcMessage) => void) | null = null;
  const failureHandlers: Array<(error: McpError) => void> = [];
  let failure: McpError | null = null;
  let closed = false;
  let started: Promise<void> | null = null;

  const fail = (error: McpError): void => {
    if (failure || closed) return;
    failure = error;
    for (const notify of failureHandlers) notify(error);
  };

  const stopListening = host.listen(id, {
    message: (message) => handler?.(message),
    // What it printed last is usually the reason: a missing package, a bad argument, a key it wanted.
    exit: (end) => fail(new McpError('program-failed', ended(label, end), end.stderr ? end.stderr.slice(-2_000) : undefined)),
  });

  const start = (): Promise<void> =>
    (started ??= host.start(id, spec).catch((error: unknown) => {
      const reason = new McpError('program-failed', error instanceof Error ? error.message : String(error));
      fail(reason);
      throw reason;
    }));

  return {
    // `npx -y` or `uvx` fetch the server on its first start, which took close to a minute on a fast connection.
    handshakeTimeoutMs: 5 * 60_000,

    async send(message) {
      if (failure) throw failure;
      if (closed) throw new McpError('protocol', 'The connection is closed.');
      await start();
      if (failure) throw failure;
      try {
        await host.send(id, message);
      } catch (error) {
        // The companion lost it — restarted, or the program ended unheard.
        const reason = new McpError('program-failed', `${label} is not running.`, error instanceof Error ? error.message : String(error));
        fail(reason);
        throw reason;
      }
    },

    onMessage(next) {
      handler = next;
    },

    onFailure(next) {
      failureHandlers.push(next);
      if (failure) next(failure);
    },

    async close() {
      closed = true;
      handler = null;
      stopListening();
      if (started) await host.stop(id).catch(() => undefined);
    },
  };
}
