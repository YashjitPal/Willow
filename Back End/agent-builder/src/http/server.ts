/**
 * HTTP layer: a request handler (CORS, optional bearer auth, routing, JSON
 * error envelopes) that backs both the standalone server (createHttpServer)
 * and a Connect-style middleware (createApiMiddleware) so the API can be
 * mounted inside another dev server (e.g. Vite) at the same origin.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppConfig } from '../config.ts';
import { createLogger } from '../util/log.ts';
import { HANDLED, HttpError, readJsonBody, Router, sendJson, type RequestCtx } from './router.ts';
import { requiredScope, type AuthPrincipal, type GovernanceService } from '../services/governance.ts';
import type { RealtimeService } from '../services/realtime.ts';

const log = createLogger('http');

const STATIC_CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8', '.cur': 'image/x-icon', '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon', '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8', '.mp4': 'video/mp4', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm', '.webm': 'video/webm', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  configuredRoot: string,
  realRootPromise: Promise<string>,
): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); }
  catch { return false; }
  if (decoded.includes('\0') || decoded.includes('\\')) return false;
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((segment) => segment.startsWith('.') && segment !== '.well-known')) return false;

  const root = path.resolve(configuredRoot);
  const requested = path.resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`);
  if (!isWithin(root, requested)) return false;

  const chooseFile = async (candidate: string): Promise<string | undefined> => {
    try {
      const stat = await fs.promises.stat(candidate);
      const file = stat.isDirectory() ? path.join(candidate, 'index.html') : candidate;
      const fileStat = stat.isDirectory() ? await fs.promises.stat(file) : stat;
      if (!fileStat.isFile()) return undefined;
      const [realRoot, realFile] = await Promise.all([realRootPromise, fs.promises.realpath(file)]);
      return isWithin(realRoot, realFile) ? realFile : undefined;
    } catch { return undefined; }
  };

  let file = await chooseFile(requested);
  if (!file && !path.extname(decoded)) file = await chooseFile(path.join(root, 'index.html'));
  if (!file) return false;

  const stat = await fs.promises.stat(file);
  const extension = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'content-type': STATIC_CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': path.basename(file) === 'index.html'
      ? 'no-cache'
      : file.includes(`${path.sep}assets${path.sep}`)
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(file).pipe(res);
  return true;
}

/**
 * Core request handler. Always produces a response (404 on unmatched routes).
 * Suitable as an http.createServer callback.
 */
export function createRequestHandler(
  router: Router,
  config: AppConfig,
  governance: GovernanceService,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const staticRoot = config.staticDir ? path.resolve(config.staticDir) : undefined;
  const realStaticRoot = staticRoot ? fs.promises.realpath(staticRoot).catch(() => staticRoot) : undefined;
  return async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = (req.method ?? 'GET').toUpperCase();
    const path = url.pathname;
    const requestId = (Array.isArray(req.headers['x-request-id']) ? req.headers['x-request-id'][0] : req.headers['x-request-id']) || randomUUID();
    let principal: AuthPrincipal | null = null;

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
        'access-control-allow-headers': 'content-type,authorization,x-provider-keys,idempotency-key,x-chatkit-client-secret,x-deployment-cohort-key,last-event-id',
        'access-control-max-age': '86400',
      });
      res.end();
      return;
    }

    try {
      // ---- scoped authentication and authorization ----
      if (path.startsWith('/api/')) {
        principal = await governance.authenticate(req.headers.authorization);
        if (!principal) throw new HttpError(401, 'missing or invalid bearer token', 'unauthorized');
        const scope = requiredScope(method, path);
        if (!governance.allows(principal, scope)) throw new HttpError(403, `scope '${scope}' is required`, 'forbidden');
      }

      const match = router.match(method, path);
      if (!match) {
        if (!path.startsWith('/api/') && staticRoot && realStaticRoot && await serveStatic(req, res, path, staticRoot, realStaticRoot)) {
          log.debug(`${method} ${path} -> ${res.statusCode} (${Date.now() - started}ms)`);
          return;
        }
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
        principal: principal!,
        requestId,
      };

      const result = await match.handler(ctx);
      if (result !== HANDLED && !res.writableEnded) {
        sendJson(res, 200, result);
      }
      if (path.startsWith('/api/') && path !== '/api/v1/health') await governance.audit({ actor: principal!, action: `${method} ${path}`, outcome: 'success', requestId, method, path, ip: req.socket.remoteAddress, resourceId: Object.values(match.params)[0] });
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
          error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
        });
      }
      if (path.startsWith('/api/') && path !== '/api/v1/health') {
        const actor = principal ?? { id: 'unauthenticated', subjectId: 'unauthenticated', workspaceId: 'unauthenticated', role: 'viewer', scopes: [], kind: 'anonymous' as const };
        await governance.audit({ actor, action: `${method} ${path}`, outcome: err.status === 401 || err.status === 403 ? 'denied' : 'error', requestId, method, path, ip: req.socket.remoteAddress }).catch(() => undefined);
      }
    }
  };
}

export function createHttpServer(router: Router, config: AppConfig, governance: GovernanceService, realtime?: RealtimeService): http.Server {
  const server = http.createServer(createRequestHandler(router, config, governance));
  realtime?.attach(server);
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
  governance: GovernanceService,
  prefix = '/api/',
): (req: IncomingMessage, res: ServerResponse, next: ConnectNext) => void {
  const handle = createRequestHandler(router, config, governance);
  return (req, res, next) => {
    const path = (req.url ?? '/').split('?')[0];
    if (!path.startsWith(prefix)) {
      next();
      return;
    }
    handle(req, res).catch((e) => next(e));
  };
}
