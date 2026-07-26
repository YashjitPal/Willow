import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { JsonValue, Run, RunEvent } from '../domain/types.ts';
import { CredentialsRequiredError, type RunEngine } from '../engine/executor.ts';
import type { AuthPrincipal } from './governance.ts';

const VERSION_PROTOCOL = 'willow.realtime.v1';
const SESSION_PROTOCOL_PREFIX = 'willow.session.';
const SESSION_TTL_MS = 60_000;
const CONNECTION_TTL_MS = 30 * 60_000;
const MAX_PENDING_SESSIONS = 1_024;
const MAX_PENDING_PER_PRINCIPAL = 16;
const MAX_ACTIVE_CONNECTIONS = 256;
const MAX_BUFFERED_BYTES = 1_048_576;
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

interface PendingRealtimeSession {
  id: string;
  secretHash: Buffer;
  runId: string;
  after: number;
  replay: boolean;
  principalKey: string;
  principal: AuthPrincipal;
  credentialExpiresAt: number;
  connectionExpiresAt: number;
  canControl: boolean;
  /** Browser origin already authorized when this one-time grant was minted. */
  origin?: string;
}

interface ActiveConnection {
  socket: WebSocket;
  alive: boolean;
  expiresAt: number;
}

interface AttachedServer {
  upgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => void;
  close: () => void;
}

export interface RealtimeSessionGrant {
  id: string;
  runId: string;
  createdAt: string;
  expiresAt: string;
  connectionExpiresAt: string;
  capabilities: Array<'events' | 'run.cancel' | 'approval.resolve'>;
  websocket: {
    url: string;
    protocols: [typeof VERSION_PROTOCOL, string];
  };
}

function publicRun(run: Run): Omit<Run, 'graph' | 'checkpoint'> {
  const copy = structuredClone(run);
  delete copy.graph;
  delete copy.checkpoint;
  return copy;
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  const body = JSON.stringify({ error: { code: 'realtime_upgrade_rejected', message } });
  socket.end(
    `HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : status === 404 ? 'Not Found' : 'Service Unavailable'}\r\n`
    + 'Content-Type: application/json; charset=utf-8\r\n'
    + `Content-Length: ${Buffer.byteLength(body)}\r\n`
    + 'Connection: close\r\n\r\n'
    + body,
  );
}

export class RealtimeService {
  private readonly engine: RunEngine;
  private readonly allowedOrigins: string[];
  private readonly onRunControlled?: (runId: string) => Promise<void>;
  private readonly pending = new Map<string, PendingRealtimeSession>();
  private readonly active = new Map<string, ActiveConnection>();
  private readonly attached = new Map<HttpServer, AttachedServer>();
  private readonly wss: WebSocketServer;
  private readonly heartbeat: NodeJS.Timeout;
  private closePromise?: Promise<void>;

  constructor(engine: RunEngine, allowedOrigins: string[], onRunControlled?: (runId: string) => Promise<void>) {
    this.engine = engine;
    this.allowedOrigins = allowedOrigins;
    this.onRunControlled = onRunControlled;
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: 64 * 1024,
      perMessageDeflate: false,
      handleProtocols: (protocols) => protocols.has(VERSION_PROTOCOL) ? VERSION_PROTOCOL : false,
    });
    this.heartbeat = setInterval(() => this.checkConnections(), 15_000);
    this.heartbeat.unref?.();
  }

  createSession(runId: string, principal: AuthPrincipal, input: { after?: number; replay?: boolean; canControl?: boolean; origin?: string } = {}): RealtimeSessionGrant {
    this.prunePending();
    const principalKey = `${principal.subjectId}\u0000${principal.workspaceId}`;
    if (this.pending.size >= MAX_PENDING_SESSIONS) throw new Error('realtime session capacity is exhausted; retry shortly');
    if ([...this.pending.values()].filter((session) => session.principalKey === principalKey).length >= MAX_PENDING_PER_PRINCIPAL) {
      throw new Error('too many pending realtime sessions for this principal');
    }
    const now = Date.now();
    const id = randomUUID().replace(/-/g, '');
    const secret = randomBytes(32).toString('base64url');
    const session: PendingRealtimeSession = {
      id,
      secretHash: createHash('sha256').update(secret).digest(),
      runId,
      after: input.after ?? 0,
      replay: input.replay !== false,
      principalKey,
      principal: structuredClone(principal),
      credentialExpiresAt: now + SESSION_TTL_MS,
      connectionExpiresAt: now + CONNECTION_TTL_MS,
      canControl: input.canControl === true,
      origin: input.origin,
    };
    this.pending.set(id, session);
    return {
      id,
      runId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(session.credentialExpiresAt).toISOString(),
      connectionExpiresAt: new Date(session.connectionExpiresAt).toISOString(),
      capabilities: session.canControl ? ['events', 'run.cancel', 'approval.resolve'] : ['events'],
      websocket: {
        url: '/api/v1/realtime',
        protocols: [VERSION_PROTOCOL, `${SESSION_PROTOCOL_PREFIX}${id}.${secret}`],
      },
    };
  }

  attach(server: HttpServer): void {
    if (this.attached.has(server)) return;
    const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => this.handleUpgrade(request, socket, head);
    const close = () => { this.attached.delete(server); };
    this.attached.set(server, { upgrade, close });
    server.on('upgrade', upgrade);
    server.once('close', close);
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/api/v1/realtime') {
      // The host server may own other WebSocket endpoints (for example Vite
      // HMR). Leave unrelated upgrades untouched for its other listeners.
      return;
    }
    if (this.active.size >= MAX_ACTIVE_CONNECTIONS) {
      rejectUpgrade(socket, 503, 'realtime connection capacity is exhausted');
      return;
    }
    const protocols = String(request.headers['sec-websocket-protocol'] ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    if (!protocols.includes(VERSION_PROTOCOL)) {
      rejectUpgrade(socket, 401, 'realtime protocol is required');
      return;
    }
    const credential = protocols.find((protocol) => protocol.startsWith(SESSION_PROTOCOL_PREFIX));
    const raw = credential?.slice(SESSION_PROTOCOL_PREFIX.length);
    const separator = raw?.indexOf('.') ?? -1;
    const id = separator > 0 ? raw!.slice(0, separator) : '';
    const secret = separator > 0 ? raw!.slice(separator + 1) : '';
    const session = this.pending.get(id);
    const suppliedHash = createHash('sha256').update(secret).digest();
    if (!session || Date.now() >= session.credentialExpiresAt || !timingSafeEqual(session.secretHash, suppliedHash)) {
      if (session && Date.now() >= session.credentialExpiresAt) this.pending.delete(id);
      rejectUpgrade(socket, 401, 'realtime session credential is invalid or expired');
      return;
    }
    const origin = request.headers.origin;
    const originAllowed = session.origin
      ? origin === session.origin
      : !origin || this.allowedOrigins.includes('*') || this.allowedOrigins.includes(origin);
    if (!originAllowed) {
      rejectUpgrade(socket, 403, 'origin is not allowed');
      return;
    }
    this.pending.delete(id);
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit('connection', ws, request);
      void this.connect(session, ws);
    });
  }

  private async connect(session: PendingRealtimeSession, socket: WebSocket): Promise<void> {
    const active: ActiveConnection = { socket, alive: true, expiresAt: session.connectionExpiresAt };
    this.active.set(session.id, active);
    socket.on('pong', () => { active.alive = true; });
    const commandState = { windowStartedAt: Date.now(), count: 0 };
    // Request IDs make control commands safely retryable when a client loses
    // the acknowledgement during a reconnect. Keep a bounded per-connection
    // response cache so a duplicate never executes the side effect twice.
    const commandResponses = new Map<string, unknown>();
    let commandQueue = Promise.resolve();
    socket.on('message', (data) => {
      commandQueue = commandQueue.then(() => this.onMessage(session, socket, data, commandState, commandResponses)).catch(() => undefined);
    });

    let cleaned = false;
    let unsubscribe: () => void = () => undefined;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      unsubscribe();
      unsubscribe = () => undefined;
      this.active.delete(session.id);
    };
    socket.once('close', cleanup);
    socket.once('error', cleanup);

    try {
      const run = await this.engine.getRun(session.runId);
      if (cleaned) return;
      if (!run) {
        this.send(socket, { type: 'error', error: { code: 'run_not_found', message: 'run no longer exists' } });
        socket.close(1008, 'run not found');
        return;
      }
      this.send(socket, { type: 'session.created', session: { id: session.id, runId: session.runId, connectionExpiresAt: new Date(session.connectionExpiresAt).toISOString() } });
      this.send(socket, { type: 'run.snapshot', run: publicRun(run) });

      let cursor = session.after;
      let replaying = true;
      const buffered: Array<{ event: RunEvent; seq: number }> = [];
      const deliver = (event: RunEvent, seq: number) => {
        if (seq <= cursor) return;
        cursor = seq;
        this.send(socket, { type: 'run.event', runId: session.runId, sequence: seq, event });
        if (event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled') {
          this.send(socket, { type: 'session.completed', runId: session.runId, status: event.type.slice('run.'.length), cursor });
          setTimeout(() => socket.close(1000, 'run settled'), 0);
        }
      };
      unsubscribe = this.engine.subscribe(session.runId, (event, seq) => {
        if (replaying) buffered.push({ event, seq });
        else deliver(event, seq);
      });
      if (cleaned) {
        unsubscribe();
        unsubscribe = () => undefined;
        return;
      }
      if (session.replay) {
        for (const record of await this.engine.pastEventRecords(session.runId, cursor)) deliver(record.event, record.seq);
      }
      replaying = false;
      for (const record of buffered) deliver(record.event, record.seq);
      const current = await this.engine.getRun(session.runId);
      if (current && TERMINAL.has(current.status) && socket.readyState === WebSocket.OPEN) {
        this.send(socket, { type: 'session.completed', runId: session.runId, status: current.status, cursor });
        socket.close(1000, 'run settled');
      }
    } catch (error) {
      this.send(socket, { type: 'error', error: { code: 'realtime_failed', message: (error as Error).message } });
      socket.close(1011, 'realtime failed');
    }
  }

  private async onMessage(
    session: PendingRealtimeSession,
    socket: WebSocket,
    data: RawData,
    rate: { windowStartedAt: number; count: number },
    commandResponses: Map<string, unknown>,
  ): Promise<void> {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(data.toString()) as Record<string, unknown>;
    } catch {
      this.send(socket, { type: 'error', error: { code: 'invalid_event', message: 'client event must be valid JSON' } });
      return;
    }
    if (message.type === 'ping') {
      this.send(socket, { type: 'pong', at: new Date().toISOString() });
      return;
    }
    const command = typeof message.type === 'string' ? message.type : 'unknown';
    const requestId = typeof message.requestId === 'string' ? message.requestId.slice(0, 128) : undefined;
    if (command !== 'run.cancel' && command !== 'approval.resolve') {
      this.commandError(socket, requestId, command, 'unsupported_command', 'unsupported realtime command');
      return;
    }
    if (!session.canControl) {
      this.commandError(socket, requestId, command, 'forbidden', 'run:control scope is required');
      return;
    }
    const now = Date.now();
    if (now - rate.windowStartedAt >= 60_000) {
      rate.windowStartedAt = now;
      rate.count = 0;
    }
    if (++rate.count > 60) {
      this.commandError(socket, requestId, command, 'rate_limit', 'realtime command rate limit exceeded');
      return;
    }
    if (requestId) {
      const prior = commandResponses.get(requestId);
      if (prior !== undefined) {
        this.send(socket, prior);
        return;
      }
    }
    const reply = (payload: unknown) => {
      if (requestId) {
        commandResponses.set(requestId, payload);
        while (commandResponses.size > 128) commandResponses.delete(commandResponses.keys().next().value!);
      }
      this.send(socket, payload);
    };
    try {
      let run: Run | undefined;
      if (command === 'run.cancel') {
        run = await this.engine.cancelRun(session.runId);
      } else {
        const approvalId = typeof message.approvalId === 'string' ? message.approvalId : '';
        if (!approvalId) throw new Error('approvalId is required');
        const hasResult = Object.prototype.hasOwnProperty.call(message, 'result');
        if (typeof message.approved !== 'boolean' && !hasResult) throw new Error('approved or result is required');
        run = await this.engine.resolveApproval(session.runId, approvalId, {
          ...(typeof message.approved === 'boolean' ? { approved: message.approved } : {}),
          ...(hasResult ? { result: message.result as JsonValue } : {}),
          ...(typeof message.reason === 'string' ? { reason: message.reason } : {}),
        }, undefined, session.principal);
      }
      if (!run) throw new Error(`run '${session.runId}' not found`);
      await this.onRunControlled?.(run.id);
      reply({ type: 'command.completed', requestId, command, run: publicRun(run) });
    } catch (error) {
      const code = error instanceof CredentialsRequiredError
        ? 'credentials_required'
        : (error as Error).message.includes('not awaiting') || (error as Error).message.includes('not pending')
          ? 'conflict'
          : 'command_failed';
      const payload = { type: 'command.error', requestId, command, error: { code, message: (error as Error).message } };
      reply(payload);
    }
  }

  private commandError(socket: WebSocket, requestId: string | undefined, command: string, code: string, message: string): void {
    this.send(socket, { type: 'command.error', requestId, command, error: { code, message } });
  }

  private send(socket: WebSocket, message: unknown): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      socket.close(1013, 'client is too slow');
      return;
    }
    socket.send(JSON.stringify(message));
  }

  private prunePending(): void {
    const now = Date.now();
    for (const [id, session] of this.pending) if (now >= session.credentialExpiresAt) this.pending.delete(id);
  }

  private checkConnections(): void {
    this.prunePending();
    const now = Date.now();
    for (const connection of this.active.values()) {
      if (now >= connection.expiresAt) {
        connection.socket.close(1000, 'session expired');
      } else if (!connection.alive) {
        connection.socket.terminate();
      } else {
        connection.alive = false;
        connection.socket.ping();
      }
    }
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.closeInner();
    return this.closePromise;
  }

  private async closeInner(): Promise<void> {
    clearInterval(this.heartbeat);
    for (const [server, listeners] of this.attached) {
      server.off('upgrade', listeners.upgrade);
      server.off('close', listeners.close);
    }
    this.attached.clear();
    this.pending.clear();
    const connections = [...this.active.values()];
    for (const connection of connections) connection.socket.close(1001, 'server shutting down');
    await Promise.all(connections.map(({ socket }) => new Promise<void>((resolve) => {
      if (socket.readyState === WebSocket.CLOSED) return resolve();
      const timeout = setTimeout(() => { socket.terminate(); resolve(); }, 1_000);
      socket.once('close', () => { clearTimeout(timeout); resolve(); });
    })));
    this.active.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}
