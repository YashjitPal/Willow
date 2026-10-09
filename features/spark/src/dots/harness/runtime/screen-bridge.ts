/**
 * How a bot reaches the user's own screen: Willow's local companion (`services/local-companion/src/screen.mjs`), in
 * the desktop app — each system its own way:
 *
 * - `windows`: the one desktop the user is looking at, shared with them. Pictures are a monitor's real pixels and
 *   positions are on the whole desktop, the monitor's own left and top added. While the bot holds the screen an
 *   overlay shows it — a glow, a pill with Stop and Esc, and the bot's own cursor — and UI Automation reaches the
 *   controls inside a window by what they are.
 * - `mac`: in the background, app by app. A picture is one window, captured where it stands; the bot works that app
 *   through Accessibility, or sends its pointer and keys to that app alone. Nothing is drawn over the user's screen.
 * - `linux`: a desktop of the bot's own, off the user's display. Apps it opens run there; nothing reaches the user's
 *   own screen. There is no accessibility reading there.
 *
 * Tests swap the whole bridge for a fake (`configureDotRuntime`).
 */
import { isDesktopApp } from '@willow/core/desktop-bridge';

export type DotScreenPlatform = 'windows' | 'mac' | 'linux';

export interface DotScreenMonitor {
  /** 1 is the main screen; the rest follow from left to right. */
  index: number;
  primary: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  /** The system's scaling for it: 1.25 at 125%. */
  scale: number;
}

export interface DotScreenWindow {
  title: string;
  process: string;
  /** One of Willow's own windows, which a bot never acts on. */
  willow: boolean;
}

export interface DotScreenInfo {
  platform?: DotScreenPlatform;
  monitors: DotScreenMonitor[];
  cursor?: { x: number; y: number };
  foreground?: DotScreenWindow;
  /** Milliseconds since the user last used the mouse or keyboard themselves; null when not since the bot last did. */
  userIdleMs: number | null;
  /** The screen is locked, or the system is showing a prompt only the user can answer. */
  locked: boolean;
  /** Linux: tools the bot's desktop needs that are not installed, and how to get them. */
  missing?: string[];
  hint?: string;
}

export interface DotScreenShot {
  /** Base64 picture: a monitor (Windows), one window (macOS) or the bot's own desktop (Linux). */
  data: string;
  /** Its format; JPEG unless it says otherwise. */
  format?: 'jpeg' | 'png';
  left?: number;
  top?: number;
  width: number;
  height: number;
  monitor?: number;
  monitors?: number;
  primary?: boolean;
  /** macOS: the window it is of. */
  window?: number;
  foreground?: DotScreenWindow;
  userIdleMs?: number | null;
}

export interface DotScreenAction {
  kind: 'click' | 'move' | 'scroll' | 'drag' | 'type' | 'key';
  x?: number;
  y?: number;
  toX?: number;
  toY?: number;
  button?: string;
  clicks?: number;
  hold?: string;
  text?: string;
  key?: string;
  deltaX?: number;
  deltaY?: number;
  /** The grant it is done under: one the user stopped from the overlay is turned away. */
  grant?: string;
  /** macOS: the app the input goes to, in the background. */
  pid?: number;
}

/** An open app window, as `apps` lists it. */
export interface DotScreenApp {
  title: string;
  /** Windows: the program; macOS: the app's name. */
  process?: string;
  app?: string;
  pid?: number;
  /** macOS and Linux: the window's id, for a picture of it or to bring it forward. */
  window?: number;
  bounds?: { left: number; top: number; width: number; height: number };
  minimized?: boolean;
  foreground?: boolean;
}

/** A control inside a window that UI Automation (Windows) or Accessibility (macOS) reaches by what it is. */
export interface DotScreenElement {
  index: number;
  role: string;
  name: string;
  value?: string;
  state?: string;
  actions?: string[];
  center?: { x: number; y: number; left: number; top: number; width: number; height: number };
  focusable?: boolean;
}

export interface DotScreenElements {
  snapshot: number;
  window: string;
  process: string;
  bounds?: { left: number; top: number; width: number; height: number };
  truncated: boolean;
  elements: DotScreenElement[];
}

/** A window a request means: a process id, a program's name, words in its title, or a window id. */
export interface DotScreenTarget {
  pid?: number;
  process?: string;
  title?: string;
  window?: number;
}

/** Why the screen turned something away. */
export type DotScreenRefusal = 'user-active' | 'willow' | 'willow-focus' | 'locked' | 'stopped';

export type DotScreenRefused = { ok: false; refused: DotScreenRefusal; message: string };

/** What the companion says of its own accord: the user stopped the bot from the overlay, by its Stop or with Esc. */
export interface DotScreenStopped {
  how: 'button' | 'escape';
  grant: string;
  session: string;
}

export interface DotScreenBridge {
  /** Whether this window can reach the user's screen at all. */
  available: () => Promise<boolean>;
  /** Which system's way it works, once available. */
  platform: () => Promise<DotScreenPlatform | null>;
  info: () => Promise<DotScreenInfo>;
  capture: (target?: { monitor?: number; window?: number }) => Promise<DotScreenShot | DotScreenRefused>;
  act: (action: DotScreenAction) => Promise<{ ok: true; cursor?: { x: number; y: number }; foreground?: DotScreenWindow } | DotScreenRefused>;
  apps: () => Promise<{ apps: DotScreenApp[] } | DotScreenRefused>;
  elements: (target: DotScreenTarget) => Promise<DotScreenElements | DotScreenRefused>;
  element: (request: { snapshot: number; index: number; action: string; value?: string }) => Promise<{ ok: true; name?: string } | DotScreenRefused>;
  focus: (target: DotScreenTarget) => Promise<{ ok: true; foreground?: boolean; title?: string } | DotScreenRefused>;
  /** Linux: opens an app on the bot's own desktop. */
  launch: (command: string) => Promise<{ ok: true; started?: string } | DotScreenRefused>;
  /** Shows the bot at the controls (Windows' overlay), under the grant the user gave; nothing elsewhere. */
  begin: (show: { name: string; color?: string; grant: string; session: string }) => Promise<unknown>;
  /** Takes the overlay down, and on Linux the bot's desktop with it. */
  end: () => Promise<unknown>;
  /** Hears the user stop the bot from the overlay. */
  onStopped: (listener: (stopped: DotScreenStopped) => void) => () => void;
}

const companion = () => import('@willow/code/local-companion').then((module) => module.localCompanion);

const platformOf = (capabilities: string[]): DotScreenPlatform | null => {
  const named = capabilities.find((capability) => capability.startsWith('screen:'))?.slice('screen:'.length);
  if (named === 'windows' || named === 'mac' || named === 'linux') return named;
  return capabilities.includes('screen') ? 'windows' : null;
};

const request = async <T>(type: string, payload: Record<string, unknown>, timeoutMs: number): Promise<T> => (await companion()).request<T>(type, payload, timeoutMs);

export const companionScreen: DotScreenBridge = {
  async available() {
    if (!isDesktopApp()) return false;
    try {
      const client = await companion();
      return (await client.connect(1_500)) && client.capabilities.includes('screen');
    } catch {
      return false;
    }
  },
  async platform() {
    if (!isDesktopApp()) return null;
    try {
      const client = await companion();
      if (!(await client.connect(1_500))) return null;
      return platformOf(client.capabilities);
    } catch {
      return null;
    }
  },
  info: () => request<DotScreenInfo>('screen.info', {}, 30_000),
  capture: (target) => request('screen.capture', { ...(target?.monitor === undefined ? {} : { monitor: target.monitor }), ...(target?.window === undefined ? {} : { window: target.window }) }, 45_000),
  act: (action) => request('screen.act', { ...action }, action.kind === 'type' ? 5 * 60_000 : 45_000),
  apps: () => request('screen.apps', {}, 20_000),
  elements: (target) => request('screen.elements', { ...target }, 45_000),
  element: (body) => request('screen.element', { ...body }, 30_000),
  focus: (target) => request('screen.focus', { ...target }, 20_000),
  launch: (command) => request('screen.launch', { command }, 30_000),
  begin: (show) => request('screen.begin', { ...show }, 20_000),
  end: () => request('screen.end', {}, 15_000),
  onStopped(listener) {
    if (!isDesktopApp()) return () => {};
    let unsubscribe = () => {};
    let cancelled = false;
    void companion().then((client) => {
      if (cancelled) return;
      unsubscribe = client.onMessage((message) => {
        if (message.type !== 'event' || message.event !== 'screen.stopped') return;
        const payload = message.payload as Record<string, unknown>;
        listener({ how: payload.how === 'button' ? 'button' : 'escape', grant: String(payload.grant ?? ''), session: String(payload.session ?? '') });
      });
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  },
};
