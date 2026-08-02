/**
 * Willow Figma — realtime WebSocket client (multiplayer presence + live ops).
 *
 * Connects to `/figma-api/v1/realtime` (same origin; ws(s) scheme derived from
 * the page). The server relays messages between peers editing the same file —
 * see ClientMessage / ServerMessage in types.ts for the wire protocol.
 */

import type { ClientMessage, DocOps, NodeId, PageId, PeerState, PresenceUser, ServerMessage } from './types';

export interface RealtimeCallbacks {
  onWelcome?: (selfId: string, peers: Array<{ peerId: string; state: PeerState }>) => void;
  onPeerJoin?: (peerId: string, state: PeerState) => void;
  onPeerLeave?: (peerId: string) => void;
  onCursor?: (peerId: string, pageId: PageId, x: number, y: number) => void;
  onCursorHide?: (peerId: string) => void;
  onSelection?: (peerId: string, ids: NodeId[], pageId: PageId) => void;
  onOps?: (peerId: string, ops: DocOps) => void;
  onStatus?: (status: 'connecting' | 'online' | 'offline') => void;
}

const CURSOR_THROTTLE_MS = 40;

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private fileId: string;
  private user: PresenceUser;
  private callbacks: RealtimeCallbacks;
  private closed = false;
  private reconnectDelay = 500;
  private pingTimer: number | null = null;
  private lastCursorSent = 0;
  private pendingCursor: { pageId: PageId; x: number; y: number } | null = null;
  private cursorFlushTimer: number | null = null;

  constructor(fileId: string, user: PresenceUser, callbacks: RealtimeCallbacks) {
    this.fileId = fileId;
    this.user = user;
    this.callbacks = callbacks;
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    this.callbacks.onStatus?.('connecting');
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    try {
      this.ws = new WebSocket(`${scheme}://${window.location.host}/figma-api/v1/realtime`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.reconnectDelay = 500;
      this.send({ t: 'hello', fileId: this.fileId, user: this.user });
      this.callbacks.onStatus?.('online');
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping' }), 25000);
    };
    this.ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      switch (msg.t) {
        case 'welcome':
          this.callbacks.onWelcome?.(msg.selfId, msg.peers);
          break;
        case 'peer-join':
          this.callbacks.onPeerJoin?.(msg.peerId, msg.state);
          break;
        case 'peer-leave':
          this.callbacks.onPeerLeave?.(msg.peerId);
          break;
        case 'cursor':
          this.callbacks.onCursor?.(msg.peerId, msg.pageId, msg.x, msg.y);
          break;
        case 'cursor-hide':
          this.callbacks.onCursorHide?.(msg.peerId);
          break;
        case 'selection':
          this.callbacks.onSelection?.(msg.peerId, msg.ids, msg.pageId);
          break;
        case 'ops':
          this.callbacks.onOps?.(msg.peerId, msg.ops);
          break;
        default:
          break;
      }
    };
    this.ws.onclose = () => {
      if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.ws = null;
      if (!this.closed) {
        this.callbacks.onStatus?.('offline');
        this.scheduleReconnect();
      }
    };
    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    window.setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10000);
  }

  private send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /** Throttled world-space cursor broadcast. */
  sendCursor(pageId: PageId, x: number, y: number): void {
    const now = Date.now();
    if (now - this.lastCursorSent >= CURSOR_THROTTLE_MS) {
      this.lastCursorSent = now;
      this.send({ t: 'cursor', pageId, x, y });
      return;
    }
    this.pendingCursor = { pageId, x, y };
    if (this.cursorFlushTimer === null) {
      this.cursorFlushTimer = window.setTimeout(() => {
        this.cursorFlushTimer = null;
        if (this.pendingCursor) {
          this.lastCursorSent = Date.now();
          this.send({ t: 'cursor', ...this.pendingCursor });
          this.pendingCursor = null;
        }
      }, CURSOR_THROTTLE_MS);
    }
  }

  hideCursor(): void {
    this.pendingCursor = null;
    this.send({ t: 'cursor-hide' });
  }

  sendSelection(ids: NodeId[], pageId: PageId): void {
    this.send({ t: 'selection', ids, pageId });
  }

  sendOps(ops: DocOps): void {
    this.send({ t: 'ops', ops });
  }

  destroy(): void {
    this.closed = true;
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    if (this.cursorFlushTimer !== null) window.clearTimeout(this.cursorFlushTimer);
    this.ws?.close();
    this.ws = null;
  }
}
