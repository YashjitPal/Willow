/**
 * How a bot reaches its own computer: its own account on the Linux machine its
 * fellow bots share on this PC, which Willow's local companion runs under WSL
 * (`services/local-companion/src/computers/`). Desktop app only.
 *
 * Pages ask for things by bot id. The machine's port and key never leave the
 * companion, and a page sees the machine through what the companion relays:
 * its state, its screen (frames only while a page watches), its wheel and the
 * step images it keeps.
 *
 * Tests swap the whole bridge for a fake (`configureDotRuntime`).
 */
import { isDesktopApp } from '@willow/core/desktop-bridge';
import type { DotHelpSource } from '../thread/thread-types';

export type DotMachineState = 'none' | 'creating' | 'stopped' | 'starting' | 'running' | 'stopping' | 'resetting';

export interface DotMachineProgress {
  stage: string;
  fraction: number;
  detail: string;
}

export interface DotMachineCursor {
  x: number;
  y: number;
  at: number;
}

/** The computer's screen: its desktop, and its browser's current page. */
export interface DotMachineScreen {
  /** What the pane draws: the whole desktop, or — on a machine that cannot have one — the page in a Chrome frame. */
  display?: 'desktop' | 'browser';
  desktop?: 'off' | 'installing' | 'starting' | 'on' | 'unavailable';
  desktopProblem?: string;
  browser: 'stopped' | 'starting' | 'running';
  url: string;
  title: string;
  favicon: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  tabs: number;
  /** The bot acted on the page in the last few seconds. */
  agentActive: boolean;
  cursor: DotMachineCursor | null;
  /** When this run of the computer began, on the clock its step pictures carry (`DotMachineShot.at`). */
  startedAt?: number;
}

export type DotHelpStatus = 'waiting' | 'taken' | 'completed' | 'cancelled' | 'expired' | 'interrupted';

export interface DotHelpRequest {
  id: string;
  reason: string;
  source: DotHelpSource;
  status: DotHelpStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  finishedAt?: string;
  interruption?: string;
}

/** Who has the wheel (OpenBot's control state): the bot, or a person it handed over to. */
export interface DotMachineControl {
  holder: 'bot' | 'human';
  since: string;
  requested: boolean;
  reason?: string;
  request?: DotHelpRequest;
  resumeSnapshotRequired: boolean;
  secretWanted?: string;
  secretRef?: string;
  secretRequestedAt?: string;
}

export interface DotMachineSummary {
  dotId: string;
  state: DotMachineState;
  error: string | null;
  /** `on` once the machine's user is kept off loopback and private networks; otherwise why not. */
  egress: string | null;
  startedAt: number | null;
  createdAt: number | null;
  screen: DotMachineScreen | null;
  control: DotMachineControl | null;
  progress: DotMachineProgress | null;
}

export type DotMachineUnavailable = 'not-desktop' | 'unreachable' | 'unsupported-os' | 'wsl-missing' | 'wsl-unresponsive';

export interface DotMachineStatus {
  supported: boolean;
  reason: DotMachineUnavailable | null;
  detail: string | null;
  wslVersion: string | null;
  base: { ready: boolean; building: boolean; progress: DotMachineProgress | null };
  machine?: DotMachineSummary;
}

/** One step's picture, as the computer keeps it for the pane's history. */
export interface DotMachineShot {
  id: string;
  seq: number;
  url: string;
  /** The page's title, or on the desktop the title of the window in front. */
  title: string;
  at: number;
  action: string;
  /** The whole desktop; without it, the page alone. */
  display?: 'desktop';
}

export interface DotMachineRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  timeoutMs?: number;
}

/** The computer service's answer: its HTTP status and body. 499 is a call that was stopped. */
export interface DotMachineReply<T = Record<string, any>> {
  status: number;
  body: T & { error?: string };
}

export type DotMachineEvent =
  | { type: 'connected' }
  | { type: 'state'; dotId: string; summary: DotMachineSummary }
  | { type: 'progress'; dotId: string | null; progress: DotMachineProgress }
  | { type: 'screen'; dotId: string; screen: DotMachineScreen }
  | { type: 'control'; dotId: string; control: DotMachineControl }
  | { type: 'shot'; dotId: string; shot: DotMachineShot }
  | { type: 'frame'; dotId: string; data: string; width: number; height: number; at: number }
  | { type: 'cursor'; dotId: string; cursor: DotMachineCursor };

/** How a bot's computer looks, in the bot's colour (`computer/dot-wallpaper.ts`): its wallpaper's colours and its browser's. */
export interface DotMachineLook {
  wallpaper: string[];
  browser: { frame: string; toolbar: string };
}

export interface DotMachineBridge {
  status: (dotId: string) => Promise<DotMachineStatus>;
  /** Tells the bot's computer how it looks now — at once if it is on; it is not turned on for this. */
  look?: (dotId: string) => Promise<void>;
  create: (dotId: string) => Promise<DotMachineSummary>;
  start: (dotId: string) => Promise<DotMachineSummary>;
  stop: (dotId: string) => Promise<DotMachineSummary>;
  reset: (dotId: string) => Promise<DotMachineSummary>;
  remove: (dotId: string) => Promise<void>;
  /** A request to the computer's service; it turns on first if it is off. Aborting stops it there. */
  call: <T = Record<string, any>>(dotId: string, request: DotMachineRequest, signal?: AbortSignal) => Promise<DotMachineReply<T>>;
  /** Frames flow to this window while it watches. */
  watch: (dotId: string, on: boolean) => Promise<void>;
  installWsl: () => Promise<void>;
  subscribe: (listener: (event: DotMachineEvent) => void) => () => void;
}

const companion = () => import('@willow/code/local-companion').then((module) => module.localCompanion);

let lookOf: (dotId: string) => DotMachineLook | null = () => null;

/** How each bot's computer looks, from whoever knows the bots (the runtime); every start and call carries it. */
export const setDotMachineLook = (resolver: (dotId: string) => DotMachineLook | null): void => {
  lookOf = resolver;
};

const settings = (dotId: string) => ({
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  locale: (typeof navigator !== 'undefined' && navigator.language) || 'en-US',
  ...(lookOf(dotId) ?? {}),
});

const unavailable = (reason: DotMachineUnavailable, detail: string | null = null): DotMachineStatus => ({
  supported: false,
  reason,
  detail,
  wslVersion: null,
  base: { ready: false, building: false, progress: null },
});

const request = async <T>(type: string, payload: Record<string, unknown>, timeoutMs = 60_000): Promise<T> => (await companion()).request<T>(type, payload, timeoutMs);

const toEvent = (name: string, payload: any): DotMachineEvent | null => {
  switch (name) {
    case 'machine.state':
      return { type: 'state', dotId: payload.dotId, summary: payload };
    case 'machine.progress':
      return { type: 'progress', dotId: payload.dotId ?? null, progress: { stage: payload.stage, fraction: payload.fraction, detail: payload.detail } };
    case 'machine.screen':
      return { type: 'screen', dotId: payload.dotId, screen: payload.screen };
    case 'machine.control':
      return { type: 'control', dotId: payload.dotId, control: payload.control };
    case 'machine.shot':
      return { type: 'shot', dotId: payload.dotId, shot: payload.shot };
    case 'machine.frame':
      return { type: 'frame', dotId: payload.dotId, data: payload.data, width: payload.width, height: payload.height, at: payload.at };
    case 'machine.cursor':
      return { type: 'cursor', dotId: payload.dotId, cursor: payload.cursor };
    default:
      return null;
  }
};

let calls = 0;

export const companionMachine: DotMachineBridge = {
  async status(dotId) {
    if (!isDesktopApp()) return unavailable('not-desktop');
    try {
      const client = await companion();
      if (!(await client.connect(1_500))) return unavailable('unreachable');
      if (!client.capabilities.includes('computers')) return unavailable('not-desktop');
      return await client.request<DotMachineStatus>('machine.status', { dotId }, 45_000);
    } catch (error) {
      return unavailable('unreachable', error instanceof Error ? error.message : String(error));
    }
  },
  async look(dotId) {
    if (!isDesktopApp()) return;
    await request('machine.look', { dotId, settings: settings(dotId) }, 30_000);
  },
  create: (dotId) => request('machine.create', { dotId }, 45 * 60_000),
  start: (dotId) => request('machine.start', { dotId, settings: settings(dotId) }, 5 * 60_000),
  stop: (dotId) => request('machine.stop', { dotId }, 2 * 60_000),
  reset: (dotId) => request('machine.reset', { dotId }, 45 * 60_000),
  async remove(dotId) {
    if (!isDesktopApp()) return;
    await request('machine.remove', { dotId }, 5 * 60_000);
  },
  async call(dotId, { method, path, body, timeoutMs = 60_000 }, signal) {
    const client = await companion();
    const callId = `call-${Date.now().toString(36)}-${(calls += 1)}`;
    const cancel = () => void client.request('machine.cancel', { callId }, 10_000).catch(() => undefined);
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      // Room for the computer to start before the call itself.
      return await client.request('machine.call', { dotId, callId, method, path, body, timeoutMs, settings: settings(dotId) }, timeoutMs + 5 * 60_000);
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  },
  async watch(dotId, on) {
    await request('machine.watch', { dotId, on }, 60_000);
  },
  async installWsl() {
    await request('machine.installWsl', {}, 30_000);
  },
  subscribe(listener) {
    if (!isDesktopApp()) return () => {};
    let unsubscribe = () => {};
    let cancelled = false;
    void companion().then((client) => {
      if (cancelled) return;
      unsubscribe = client.onMessage((message) => {
        if (message.type === 'ready') {
          listener({ type: 'connected' });
          return;
        }
        if (message.type !== 'event' || !message.event.startsWith('machine.')) return;
        const event = toEvent(message.event, message.payload);
        if (event) listener(event);
      });
      void client.connect(1_500).catch(() => false);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  },
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A failure reaching the computer, in words the user — and the bot — can act on. */
export const machineProblem = (error: unknown): string => {
  const message = errorText(error);
  if (/not running|unavailable|disconnected|companion request timed out/i.test(message)) {
    return "Willow can't reach your computer right now: its companion is not running. It comes back when Willow restarts.";
  }
  if (/Unknown companion request/i.test(message)) return "Willow's companion here is out of date and can't run your computer. Update Willow.";
  return message;
};
