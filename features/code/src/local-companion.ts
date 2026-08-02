/**
 * Thin browser-side client for the optional Willow local companion.
 *
 * The companion is deliberately a transport, not an agent planner. Spark can
 * render its browser frames when the companion is installed and fall back to
 * the existing embedded session when it is not.
 */

export interface CompanionTab {
  id: string;
  title: string;
  url: string;
  active?: boolean;
  index?: number;
}

export interface CompanionFrame {
  sessionId: string;
  tabId?: string;
  dataUrl: string;
  width: number;
  height: number;
  url: string;
}

export interface CompanionTabsResult {
  sessionId: string;
  tabs: CompanionTab[];
  activeTabId?: string;
  frame?: CompanionFrame | null;
}

export interface CompanionEvent {
  type: 'event';
  event: 'browser.frame' | 'browser.tabs' | 'browser.error';
  payload: CompanionFrame | CompanionTabsResult | { sessionId: string; message: string };
}

interface CompanionResponse {
  id: string;
  type: 'result';
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface CompanionReady {
  type: 'ready';
  version: number;
  sessionId: string;
  capabilities: string[];
}

type CompanionMessage = CompanionResponse | CompanionEvent | CompanionReady;

type CompanionListener = (message: CompanionMessage) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: number;
}

const DEFAULT_PORT = 43117;
const getStorageValue = (key: string): string => {
  try { return window.localStorage.getItem(key) || ''; } catch { return ''; }
};

const getCompanionUrl = (): string => {
  const configured = getStorageValue('willow_companion_url').trim();
  if (configured) return configured.replace(/\/$/, '');
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//127.0.0.1:${DEFAULT_PORT}/ws`;
};

export class LocalCompanionClient {
  private socket: WebSocket | null = null;
  private connectPromise: Promise<boolean> | null = null;
  private requestCounter = 0;
  private pending = new Map<string, PendingRequest>();
  private listeners = new Set<CompanionListener>();
  private ready: CompanionReady | null = null;

  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN && Boolean(this.ready);
  }

  get sessionId(): string | null {
    return this.ready?.sessionId ?? null;
  }

  onMessage(listener: CompanionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(timeoutMs = 650): Promise<boolean> {
    if (this.isConnected) return true;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = new Promise<boolean>((resolve) => {
      let settled = false;
      let timer = 0;
      const finish = (connected: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        this.connectPromise = null;
        resolve(connected);
      };
      const token = getStorageValue('willow_companion_token');
      let url: URL;
      try {
        url = new URL(getCompanionUrl(), window.location.href);
      } catch {
        finish(false);
        return;
      }
      if (token) url.searchParams.set('token', token);
      let socket: WebSocket;
      try {
        socket = new WebSocket(url.toString());
      } catch {
        finish(false);
        return;
      }
      this.socket = socket;
      timer = window.setTimeout(() => {
        try { socket.close(); } catch { /* best effort */ }
        finish(false);
      }, timeoutMs);
      socket.onopen = () => undefined;
      socket.onmessage = (event) => {
        let message: CompanionMessage;
        try { message = JSON.parse(String(event.data)) as CompanionMessage; } catch { return; }
        if (message.type === 'ready') {
          this.ready = message;
          finish(true);
        }
        this.routeMessage(message);
      };
      socket.onerror = () => finish(false);
      socket.onclose = () => {
        this.ready = null;
        this.socket = null;
        this.rejectPending(new Error('The Willow local companion disconnected.'));
        finish(false);
      };
    });
    return this.connectPromise;
  }

  async request<T = unknown>(type: string, payload: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
    if (!(await this.connect())) throw new Error('Willow local companion is not running.');
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('Willow local companion is unavailable.');
    const id = `request-${Date.now()}-${this.requestCounter += 1}`;
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Companion request timed out: ${type}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      socket.send(JSON.stringify({ id, type, payload }));
    });
  }

  close(): void {
    try { this.socket?.close(); } catch { /* best effort */ }
    this.socket = null;
    this.ready = null;
    this.rejectPending(new Error('Companion connection closed.'));
  }

  private routeMessage(message: CompanionMessage): void {
    if (message.type === 'result') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      window.clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error || 'Companion request failed.'));
    }
    this.listeners.forEach((listener) => listener(message));
  }

  private rejectPending(error: Error): void {
    this.pending.forEach(({ reject, timer }) => {
      window.clearTimeout(timer);
      reject(error);
    });
    this.pending.clear();
  }
}

export const localCompanion = new LocalCompanionClient();
