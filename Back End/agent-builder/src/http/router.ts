/**
 * Minimal HTTP framework on node:http — path params, JSON bodies, CORS,
 * error envelopes, SSE helper. No external dependencies.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'error') {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export interface RequestCtx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  /** Parsed JSON body (undefined when none). */
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}

export type Handler = (ctx: RequestCtx) => Promise<unknown> | unknown;

interface Route {
  method: string;
  segments: string[]; // ':name' marks a param
  handler: Handler;
}

const MAX_BODY = 64 * 1024 * 1024; // 64 MB (vector store file uploads)

export class Router {
  private routes: Route[] = [];

  on(method: string, pattern: string, handler: Handler): this {
    const segments = pattern.split('/').filter(Boolean);
    this.routes.push({ method: method.toUpperCase(), segments, handler });
    return this;
  }

  get(pattern: string, handler: Handler): this { return this.on('GET', pattern, handler); }
  post(pattern: string, handler: Handler): this { return this.on('POST', pattern, handler); }
  put(pattern: string, handler: Handler): this { return this.on('PUT', pattern, handler); }
  patch(pattern: string, handler: Handler): this { return this.on('PATCH', pattern, handler); }
  delete(pattern: string, handler: Handler): this { return this.on('DELETE', pattern, handler); }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | undefined {
    const parts = path.split('/').filter(Boolean);
    outer: for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      for (let i = 0; i < parts.length; i++) {
        const seg = route.segments[i];
        if (seg.startsWith(':')) {
          params[seg.slice(1)] = decodeURIComponent(parts[i]);
        } else if (seg !== parts[i]) {
          continue outer;
        }
      }
      return { handler: route.handler, params };
    }
    return undefined;
  }

  /** True if any route matches the path with a different method (405 support). */
  pathExists(path: string): boolean {
    const parts = path.split('/').filter(Boolean);
    return this.routes.some((route) => {
      if (route.segments.length !== parts.length) return false;
      return route.segments.every((seg, i) => seg.startsWith(':') || seg === parts[i]);
    });
  }
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'request body too large');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'request body must be valid JSON');
  }
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  if (res.writableEnded) return;
  const body = JSON.stringify(data ?? null);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Response marker: handler manages the response itself (e.g. SSE). */
export const HANDLED: unique symbol = Symbol('handled');

export interface SseStream {
  send(event: string, data: unknown): void;
  close(): void;
  onClose(fn: () => void): void;
  readonly closed: boolean;
}

export function openSse(ctx: RequestCtx): SseStream {
  const { res, req } = ctx;
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': connected\n\n');

  let closed = false;
  const closeFns: Array<() => void> = [];
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': ping\n\n');
  }, 15_000);
  heartbeat.unref?.();

  const doClose = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    for (const fn of closeFns) {
      try {
        fn();
      } catch { /* ignore */ }
    }
    try {
      res.end();
    } catch { /* ignore */ }
  };
  req.on('close', doClose);

  return {
    send(event, data) {
      if (closed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close: doClose,
    onClose(fn) {
      closeFns.push(fn);
    },
    get closed() {
      return closed;
    },
  };
}
