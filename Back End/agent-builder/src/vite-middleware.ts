/**
 * Vite (or any Connect host) integration entry point.
 *
 * Lets the Agent Builder API run **in-process** inside another dev server so
 * the whole thing is one command on one origin (no second port, no CORS).
 * The standalone server (src/index.ts) is unchanged and still used for
 * production / running the backend on its own.
 *
 * Usage from a Vite plugin's configureServer:
 *
 *   const { createAgentBuilderMiddleware } =
 *     await import('<abs path>/Back End/agent-builder/src/vite-middleware.ts');
 *   const { middleware, close } = await createAgentBuilderMiddleware();
 *   server.middlewares.use(middleware);          // handles /api/v1/*, next() otherwise
 *   server.httpServer?.once('close', () => close());
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './index.ts';
import { createApiMiddleware, type ConnectNext } from './http/server.ts';
import { createLogger } from './util/log.ts';

const log = createLogger('vite');

export interface AgentBuilderMiddleware {
  middleware: (req: IncomingMessage, res: ServerResponse, next: ConnectNext) => void;
  /** Tear down storage + MCP connections when the host server closes. */
  close: () => Promise<void>;
  /** The route prefix handled by the middleware. */
  prefix: string;
}

export async function createAgentBuilderMiddleware(
  opts: { prefix?: string } = {},
): Promise<AgentBuilderMiddleware> {
  const prefix = opts.prefix ?? '/api/';
  const app = await createApp();
  log.info(`Agent Builder API mounted as middleware at ${prefix}v1 (data dir: ${app.config.dataDir})`);
  return {
    middleware: createApiMiddleware(app.router, app.config, prefix),
    close: app.close,
    prefix,
  };
}
