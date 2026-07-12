/**
 * HTTP layer: a request handler (CORS, optional bearer auth, routing, JSON
 * error envelopes) that backs both the standalone server (createHttpServer)
 * and a Connect-style middleware (createApiMiddleware) so the API can be
 * mounted inside another dev server (e.g. Vite) at the same origin.
 */

import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppConfig } from '../config.ts';
import { createLogger } from '../util/log.ts';
import { HANDLED, HttpError, readJsonBody, Router, sendJson, type RequestCtx } from './router.ts';

const log = createLogger('http');

/**
 * Core request handler. Always produces a response (404 on unmatched routes).
 * Suitable as an http.createServer callback.
 */
export function createRequestHandler(
  router: Router,
  config: AppConfig,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = (req.method ?? 'GET').toUpperCase();
    const path = url.pathname;

    // ---- CORS ----
    const origin = req.headers.origin;
    if (origin && (config.corsOrigins.includes(origin) || config.corsOrigins.includes('*'))) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
      res.setHeader('access-control-allow-credentials', 'true');
    }
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': 'content-type,authorization,x-provider-keys',
        'access-control-max-age': '86400',
      });
      res.end();
      return;
    }

    try {
      // ---- auth (optional) ----
      if (config.apiToken && path.startsWith('/api/')) {
        const auth = req.headers.authorization;
        if (auth !== `Bearer ${config.apiToken}`) {
          throw new HttpError(401, 'missing or invalid bearer token', 'unauthorized');
        }
      }

      const match = router.match(method, path);
      if (!match) {
        if (router.pathExists(path)) {
          throw new HttpError(405, `method ${method} not allowed for ${path}`, 'method_not_allowed');
        }
        throw new HttpError(404, `no route for ${method} ${path}`, 'not_found');
      }

      const body =
        method === 'GET' || method === 'HEAD' || method === 'DELETE'
          ? undefined
          : await readJsonBody(req);

      const ctx: RequestCtx = {
        req,
        res,
        method,
        path,
        params: match.params,
        query: url.searchParams,
        body,
        headers: req.headers,
      };

      const result = await match.handler(ctx);
      if (result !== HANDLED && !res.writableEnded) {
        sendJson(res, 200, result);
      }
      log.debug(`${method} ${path} -> ${res.statusCode} (${Date.now() - started}ms)`);
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(500, (e as Error).message ?? 'internal error');
      if (err.status >= 500) {
        log.error(`${method} ${path} -> ${err.status}: ${(e as Error).stack ?? err.message}`);
      } else {
        log.debug(`${method} ${path} -> ${err.status}: ${err.message}`);
      }
      if (!res.writableEnded) {
        sendJson(res, err.status, {
          error: { code: err.code, message: err.message },
        });
      }
    }
  };
}

export function createHttpServer(router: Router, config: AppConfig): http.Server {
  const server = http.createServer(createRequestHandler(router, config));
  // long-lived SSE connections
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  return server;
}

export type ConnectNext = (err?: unknown) => void;

/**
 * Connect/Express-style middleware. Only handles requests under `prefix`
 * (default '/api/'); everything else falls through via next() so a host dev
 * server (Vite) can serve the frontend. Same origin ⇒ no CORS/second port.
 */
export function createApiMiddleware(
  router: Router,
  config: AppConfig,
  prefix = '/api/',
): (req: IncomingMessage, res: ServerResponse, next: ConnectNext) => void {
  const handle = createRequestHandler(router, config);
  return (req, res, next) => {
    const path = (req.url ?? '/').split('?')[0];
    if (!path.startsWith(prefix)) {
      next();
      return;
    }
    handle(req, res).catch((e) => next(e));
  };
}
