/**
 * The seam between Willow's web code and the Willow desktop app (Tauri).
 *
 * Willow runs the same code in a browser tab and in the desktop app. Everything
 * the desktop adds — a native folder picker, native notifications, staying alive
 * in the background — is reached through this module, so no feature ever
 * touches Tauri directly and every call degrades to something sensible in a
 * browser.
 *
 * The desktop side is reached through Tauri's injected IPC
 * (`window.__TAURI_INTERNALS__.invoke`), using the commands of the official
 * dialog and notification plugins. That keeps this module free of a Tauri
 * package dependency, so the browser build carries none of it.
 *
 * The API here is the contract: features call these functions and nothing else.
 * The desktop app (`apps/desktop`) owns their desktop implementation.
 */
import { androidApp, androidHarnessConnection, isAndroidApp } from './android-bridge';

type TauriInternals = { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };

const tauri = (): TauriInternals | null => {
  if (typeof window === 'undefined') return null;
  const internals = (window as Window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  return internals && typeof internals.invoke === 'function' ? internals : null;
};

/** Whether Willow is running inside the Willow desktop app. */
export const isDesktopApp = (): boolean => tauri() !== null;

/**
 * Asks the user to choose a folder and returns its absolute path, or null if
 * they cancelled. Only the desktop app can return a real path; in a browser this
 * returns null and callers ask the user to type one instead.
 */
export const pickDirectory = async (title = 'Choose a folder'): Promise<string | null> => {
  const internals = tauri();
  if (!internals) return null;
  const picked = await internals.invoke('plugin:dialog|open', { options: { directory: true, multiple: false, title } });
  return typeof picked === 'string' && picked ? picked : null;
};

type WebViewMessage = { data: unknown; additionalObjects?: ArrayLike<unknown> };
type WebViewHost = {
  addEventListener: (type: 'message', listener: (event: WebViewMessage) => void) => void;
  removeEventListener: (type: 'message', listener: (event: WebViewMessage) => void) => void;
};

const webViewHost = (): WebViewHost | null =>
  (window as Window & { chrome?: { webview?: WebViewHost } }).chrome?.webview ?? null;

let localFolderRequests = 0;

/**
 * The Willow folder the desktop app keeps for its pages, as a handle that can already read and
 * write (`apps/desktop/src-tauri/src/local_folder.rs`): the folder picked in Settings, else
 * `<home>\Willow`, or `path`, which `keep` makes the folder from then on. `create` makes the
 * folder when it is missing. Null in a browser, and when the app cannot hand it over (the
 * folder is missing and `create` is off, or not on Windows).
 */
export const openDesktopLocalFolder = async (
  options: { create?: boolean; path?: string; keep?: boolean } = {},
): Promise<FileSystemDirectoryHandle | null> => {
  const internals = tauri();
  const host = typeof window === 'undefined' ? null : webViewHost();
  if (!internals || !host) return null;
  const request = ++localFolderRequests;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (handle: FileSystemDirectoryHandle | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      host.removeEventListener('message', onMessage);
      resolve(handle);
    };
    const onMessage = (event: WebViewMessage) => {
      const data = event.data as { willowLocalFolder?: unknown } | null;
      if (!data || data.willowLocalFolder !== request) return;
      const handle = event.additionalObjects?.[0] as FileSystemHandle | undefined;
      finish(handle?.kind === 'directory' ? handle as FileSystemDirectoryHandle : null);
    };
    const timer = window.setTimeout(() => finish(null), 15_000);
    host.addEventListener('message', onMessage);
    internals
      .invoke('local_folder_open', { request, create: Boolean(options.create), path: options.path ?? null, keep: Boolean(options.keep) })
      .catch(() => finish(null));
  });
};

/**
 * How many agent threads wait on the user, on Willow's taskbar button. On Windows it shows as
 * `icon`, `size` pixels square in RGBA; elsewhere as the platform's badge count.
 */
export const setHarnessBadge = async (count: number, icon?: { rgba: number[]; size: number }): Promise<void> => {
  const internals = tauri();
  if (!internals) return;
  await internals.invoke('harness_set_badge', { count, rgba: icon?.rgba ?? null, size: icon?.size ?? null });
};

export interface PickFileOptions {
  title: string;
  filters?: { name: string; extensions: string[] }[];
  defaultPath?: string;
}

/** One file from the system picker, or null when it is dismissed. */
export const pickFile = async (options: PickFileOptions): Promise<string | null> => {
  const internals = tauri();
  if (!internals) return null;
  const picked = await internals.invoke('plugin:dialog|open', { options: { ...options, directory: false, multiple: false } });
  return typeof picked === 'string' && picked ? picked : null;
};

/** Whether Willow may show notifications right now. Willow's Android app asks Android itself, as it shows one. */
export const notificationsAllowed = async (): Promise<boolean> => {
  if (isAndroidApp()) return true;
  const internals = tauri();
  if (internals) return Boolean(await internals.invoke('plugin:notification|is_permission_granted').catch(() => false));
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
};

/** Asks for permission to show notifications. Call it from a user gesture. */
export const requestNotificationPermission = async (): Promise<boolean> => {
  if (isAndroidApp()) return true;
  const internals = tauri();
  if (internals) {
    const answer = await internals.invoke('plugin:notification|request_permission').catch(() => 'denied');
    return answer === 'granted' || answer === true;
  }
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
};

export interface WillowNotification {
  title: string;
  body: string;
  /** Notifications with the same tag replace each other instead of stacking. */
  tag?: string;
}

/** Shows a notification if permitted. Resolves to whether one was shown. */
export const showNotification = async ({ title, body, tag }: WillowNotification): Promise<boolean> => {
  const android = androidApp();
  if (android) {
    android.post({ kind: 'notify', title, body, ...(tag ? { tag } : {}) });
    return true;
  }
  if (!(await notificationsAllowed())) return false;
  const internals = tauri();
  if (internals) {
    await internals.invoke('plugin:notification|notify', { options: { title, body } }).catch(() => undefined);
    return true;
  }
  try {
    new Notification(title, { body, tag });
    return true;
  } catch {
    return false;
  }
};

/** Whether Willow's window is out of the user's sight: hidden, minimised, or behind other windows. */
export const isAppInBackground = (): boolean =>
  typeof document !== 'undefined' && (document.hidden || !document.hasFocus());

/* ── Messages from the desktop app ──────────────────────────────────────────
 *
 * The app reaches a page by calling `window.__WILLOW_DESKTOP__.receive(message)`
 * in it (apps/desktop src-tauri/src/pets.rs). Each tab is a page of its own, so
 * a message lands in the tab the app chose: the one that opened the overlay,
 * the one keeping the pet, or the one in front.
 */

export type DesktopMessage =
  /** Something the overlay's surface said, for the page that opened it. */
  | { kind: 'overlay'; message: unknown }
  /** A pet package or a creation in progress changed on disk. */
  | { kind: 'pets-changed' }
  /** The strip's paw was pressed. */
  | { kind: 'pets-toggle' }
  /** The pet asked to open a task, or for the composer. */
  | { kind: 'pets-show'; taskId?: string; composer?: boolean }
  /**
   * One of the strip's menus opened under its button, `left` device pixels in (the strip and
   * the page may be zoomed apart), or closed (`menu: null`).
   */
  | { kind: 'app-menu'; menu: DesktopMenu | null; left: number }
  /**
   * The right-click menu (menus.rs): WebView2's own commands for what was clicked, at `x`, `y`
   * in the page's own pixels, and the text selected there, if any.
   */
  | { kind: 'context-menu'; id: number; x: number; y: number; items: DesktopContextMenuItem[]; selection: string | null }
  /** One of the strip's tooltips, for the page to draw under its button (`text: null` puts it away). */
  | { kind: 'strip-tooltip'; text: string | null; left: number; right: number }
  /** A window capture's progress, for the agents' page (T3's `DesktopSnapShotEvent`, snapshots.rs). */
  | { kind: 'snapshot'; event: { type: string; id?: string } }
  /** What one of the agents' browser tabs shows now, or that it was clicked into (harness_preview.rs). */
  | { kind: 'harness-preview'; id: string; state?: HarnessPreviewState; focused?: boolean }
  /**
   * One of the agents' panel tabs the strip draws was chosen, closed or right-clicked, or its +
   * was pressed, `left` to `right` device pixels in (tabs.rs `panel_tab`).
   */
  | { kind: 'panel-tab'; action: StripPanelTabAction; id: string | null; left: number; right: number };

/** A row of the right-click menu, as WebView2 offers it. */
export interface DesktopContextMenuItem {
  /** WebView2's own name for the command (`copy`, `paste`, `spellCheck`, …). */
  name: string;
  label: string;
  shortcut: string;
  /** `null` for a divider. */
  command: number | null;
  enabled: boolean;
  /** A check box's state; `null` for anything else. */
  checked: boolean | null;
}

/** The strip's application menus, which the page in front draws (tabs.rs `menu_open`). */
export type DesktopMenu = 'file' | 'edit' | 'view';

/** Edit and zoom commands the app presses as their keys, so the page does its own for them. */
export type DesktopMenuKeys = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'delete' | 'selectAll' | 'zoomIn' | 'zoomOut' | 'zoomReset';

const desktopListeners = new Set<(message: DesktopMessage) => void>();

const receiveDesktopMessages = (): void => {
  if (typeof window === 'undefined') return;
  const target = window as Window & { __WILLOW_DESKTOP__?: { receive(message: DesktopMessage): void } };
  target.__WILLOW_DESKTOP__ ??= {
    receive(message) {
      for (const listener of [...desktopListeners]) {
        try {
          listener(message);
        } catch {
          // One listener throwing must not stop the others.
        }
      }
    },
  };
};

export const onDesktopMessage = (listener: (message: DesktopMessage) => void): (() => void) => {
  receiveDesktopMessages();
  desktopListeners.add(listener);
  return () => void desktopListeners.delete(listener);
};

/* ── The desktop overlay ────────────────────────────────────────────────────
 *
 * A transparent, always-on-top window over a display's work area, where a
 * surface draws something that stays on the desktop while Willow is behind other
 * windows (the pet). The surface is a self-contained function, sent as source
 * and run there with `(Overlay, data)`; `Overlay` is its only way out: pointer
 * input while the cursor is over something it drew, keyboard focus while it is
 * typed into, and messages back to this page.
 */

export interface DesktopOverlaySurface {
  /** A function's source, called as `(Overlay, data)`. */
  script: string;
  styles: string;
  data: unknown;
  /** Which display it covers: the primary one (the default), or the one under the cursor. */
  display?: 'primary' | 'cursor';
}

export interface DesktopOverlayStatus {
  open: boolean;
  bounds?: { x: number; y: number; width: number; height: number; scaleFactor: number };
  message?: string;
}

export const openDesktopOverlay = async (surface: DesktopOverlaySurface): Promise<DesktopOverlayStatus> => {
  const internals = tauri();
  if (!internals) return { open: false, message: 'Only the Willow desktop app has a desktop overlay.' };
  try {
    return (await internals.invoke('overlay_open', { surface })) as DesktopOverlayStatus;
  } catch (error) {
    return { open: false, message: error instanceof Error ? error.message : String(error) };
  }
};

/** Page to surface. Only the page that opened the overlay is heard. */
export const postDesktopOverlay = (message: unknown): void => {
  void tauri()?.invoke('overlay_post', { message }).catch(() => undefined);
};

export const closeDesktopOverlay = (): void => {
  void tauri()?.invoke('overlay_close').catch(() => undefined);
};

/* ── The pet library ────────────────────────────────────────────────────────
 *
 * Pets created on this computer: `Pets/<id>/pet.json` and a version 2 sprite
 * sheet in the Willow folder, validated by the app. Read and load reject
 * with the app's own message when the library cannot be used.
 */

export interface DesktopPetRecord {
  id: string;
  displayName: string;
  description: string;
  spriteVersionNumber: 2;
  /** Changes with the manifest or the sheet, so what was drawn from them can be cached against it. */
  stamp: string;
}

export interface DesktopPetSprite extends DesktopPetRecord {
  spritesheetDataUrl: string;
}

export type DesktopPetCreationStage = 'preparing' | 'imagining' | 'posing' | 'hatching' | 'ready' | 'error';

export interface DesktopPetCreationRun {
  id: string;
  name: string;
  stage: DesktopPetCreationStage;
  updatedAt: string;
  petId?: string;
  previewDataUrl?: string;
  message?: string;
}

export interface DesktopPetLibrary {
  enabled: boolean;
  directory: string;
  skillPath: string | null;
  pets: DesktopPetRecord[];
  runs: DesktopPetCreationRun[];
  /** Packages that could not be used, one per line. */
  message?: string;
}

const desktopCall = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  const internals = tauri();
  if (!internals) throw new Error('Pets are part of the Willow desktop app.');
  try {
    return (await internals.invoke(command, args)) as T;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
};

export const readDesktopPets = (): Promise<DesktopPetLibrary> => desktopCall('pets_read');

export const loadDesktopPet = (id: string): Promise<DesktopPetSprite> => desktopCall('pets_load', { id });

/** Where the Hatch Pet skill is, and the library it writes into. */
export const prepareDesktopPetCreation = (): Promise<{ skillPath: string; directory: string }> =>
  desktopCall('pets_prepare_creation');

export const openDesktopPetFolder = (): Promise<void> => desktopCall('pets_open_folder');

/** An image inside a pet's creation run (`.hatching/<run>/…`), as a data URL. */
export const readDesktopPetImage = (path: string): Promise<string> => desktopCall('pets_read_image', { path });

/** Saves base64 image data inside a pet's creation run; resolves to the path it was saved at. */
export const writeDesktopPetImage = (path: string, data: string): Promise<string> => desktopCall('pets_write_image', { path, data });

/** Tells the app whether the pet is out, which the strip's paw shows. */
export const reportDesktopPetShown = (shown: boolean): void => {
  void tauri()?.invoke('pets_report_shown', { shown }).catch(() => undefined);
};

/**
 * The coding agents' server, for the agent tabs (apps/desktop src-tauri/src/harness.rs): its
 * origin, which also serves the tabs' page, and the token that page signs in with. Starts it if
 * it is not running, so this can take a while the first time.
 */
export interface HarnessConnection {
  url: string;
  token: string;
}

const harnessCall = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  const internals = tauri();
  if (!internals) throw new Error('The coding agents are part of the Willow desktop app.');
  try {
    return (await internals.invoke(command, args)) as T;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
};

/** On Willow's Android app, the computer's server through the app (android-bridge.ts). */
export const getHarnessConnection = (): Promise<HarnessConnection> =>
  isAndroidApp() ? androidHarnessConnection() : harnessCall('harness_connection');

/** Whether the agents' server is open to the network, and where (T3's `DesktopServerExposureState`, with its port). */
export interface HarnessExposure {
  mode: 'local-only' | 'network-accessible';
  endpointUrl: string | null;
  advertisedHost: string | null;
  tailscaleServeEnabled: boolean;
  tailscaleServePort: number;
  port: number | null;
}

/** This computer on the tailnet, when Tailscale is installed and signed in. */
export interface HarnessTailscale {
  dnsName: string | null;
  ipv4: string | null;
}

export const getHarnessExposure = (): Promise<HarnessExposure> => harnessCall('harness_exposure');

/** Opens the agents' server to the local network, or closes it again; the server restarts. */
export const setHarnessExposure = (mode: HarnessExposure['mode']): Promise<HarnessExposure> =>
  harnessCall('harness_set_exposure', { mode });

/** Turns the server's Tailscale Serve (HTTPS on the tailnet) on or off; the server restarts. */
export const setHarnessTailscaleServe = (enabled: boolean, port?: number): Promise<HarnessExposure> =>
  harnessCall('harness_set_tailscale_serve', { enabled, port: port ?? null });

export const getHarnessTailscale = (): Promise<HarnessTailscale | null> => harnessCall('harness_tailscale');

/**
 * The agents' browser (apps/desktop src-tauri/src/harness_preview.rs): on Windows each of its
 * tabs is a webview of its own laid over Willow's page, since most sites refuse to show in a
 * frame. Areas are in physical pixels from the page's top left, with their corners' radius.
 */
export interface HarnessPreviewArea {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

export type HarnessPreviewRequest =
  | { action: 'open'; id: string; url: string }
  /** Where the tab goes, what is drawn over it there, and its zoom; `bounds: null` hides it. */
  | { action: 'place'; id: string; bounds: HarnessPreviewArea | null; holes: HarnessPreviewArea[]; zoom: number }
  | { action: 'back' | 'forward' | 'reload' | 'stop' | 'close'; id: string }
  | { action: 'closeAll' };

export interface HarnessPreviewState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Why the page could not be reached, by Chromium's name and code for it. */
  failed: { code: number; description: string } | null;
}

/** Whether the agents' browser has webviews of its own here; elsewhere its tabs are frames. */
export const hasHarnessPreview = (): boolean =>
  isDesktopApp() && typeof navigator !== 'undefined' && /^Win/.test(navigator.platform);

export const harnessPreview = (request: HarnessPreviewRequest): Promise<void> => harnessCall('harness_preview', { request });

/** One of the agents' side panel's tabs, for the strip to draw (tabs.rs `PanelTab`). */
export interface StripPanelTab {
  id: string;
  title: string;
  active: boolean;
  /** Something new in the tab since it was last on show. */
  pending?: boolean;
  /** The site's icon, by address. */
  image?: string;
  /** The tab's glyph as a PNG mask (`data:image/png;base64,…`), filled with the strip's text colour. */
  mask?: string;
}

/** The agents' side panel's tabs, drawn from the panel's left edge, `left` device pixels in, to the window buttons. */
export interface StripPanelTabs {
  left: number;
  tabs: StripPanelTab[];
  /** Whether the panel offers its + (a menu of what it can open). */
  add: boolean;
}

export type StripPanelTabAction = 'select' | 'close' | 'add' | 'menu';

/** The desktop app draws the agents' side panel's tabs in its strip, over the panel. */
export const hasStripPanelTabs = (): boolean => isDesktopApp();

/** Hands the strip the agents' side panel's tabs to draw, or takes them away (`null`). */
export const setStripPanelTabs = (tabs: StripPanelTabs | null): void => {
  void tauri()?.invoke('strip_panel_tabs', { tabs }).catch(() => undefined);
};

/**
 * The agents' window captures (apps/desktop src-tauri/src/snapshots.rs), which the agents' page
 * reads with T3's `DesktopSnapShot*` shapes; Willow passes them through untouched.
 */
export const harnessSnapShot = {
  configure: (enabled: boolean, shortcut: unknown, includeAccessibility: boolean): Promise<unknown> =>
    harnessCall('snapshot_configure', { enabled, shortcut, includeAccessibility }),
  state: (): Promise<unknown> => harnessCall('snapshot_state'),
  checkShortcut: (shortcut: unknown): Promise<unknown> => harnessCall('snapshot_check_shortcut', { shortcut }),
  suppress: (suppressed: boolean): Promise<void> => harnessCall('snapshot_suppress', { suppressed }),
  pending: (): Promise<unknown[]> => harnessCall('snapshot_pending'),
  read: (id: string): Promise<unknown> => harnessCall('snapshot_read', { id }),
  acknowledge: (id: string): Promise<void> => harnessCall('snapshot_ack', { id }),
};

/**
 * Tells the app the frame's shell colour (`#rrggbb`), so the strip above it matches. Kept for
 * the page's own first paint too (`#willow-boot` in apps/studio/index.html), which draws the
 * frame before any of Willow has loaded.
 */
export const reportDesktopFrame = (color: string, light: boolean): void => {
  try {
    window.localStorage.setItem('willow:desktop-frame', JSON.stringify({ color, light }));
  } catch {
    // Storage blocked: the first paint falls back to the colour the app passes it.
  }
  void tauri()?.invoke('tab_frame', { color, light }).catch(() => undefined);
};

/**
 * Whether the window's buttons are Willow's to choose: in the desktop app, but not on macOS,
 * which always shows its own traffic lights.
 */
export const canChooseWindowButtons = (): boolean =>
  isDesktopApp() && typeof navigator !== 'undefined' && !/Mac/.test(navigator.platform);

/** Tells the app which window buttons Labs has chosen: macOS's at the strip's left, or Windows' own. */
export const reportDesktopWindowButtons = (mac: boolean): void => {
  void tauri()?.invoke('window_buttons', { mac }).catch(() => undefined);
};

/** Opens one of the strip's menus under its button (`left`), or closes the open one (`null`). */
export const setDesktopMenu = (menu: DesktopMenu | null, left?: number): void => {
  void tauri()?.invoke('menu_open', { menu, left: left ?? null }).catch(() => undefined);
};

/** Opens a menu under its own button, as its access key does (the strip knows where it is). */
export const openDesktopMenu = (menu: DesktopMenu): void => {
  void tauri()?.invoke('menu_key', { menu }).catch(() => undefined);
};

/** Presses an Edit or zoom command's keys into this page; false where the app cannot, so the page does it itself. */
export const pressDesktopMenuKeys = (action: DesktopMenuKeys): Promise<boolean> =>
  tauri()?.invoke('menu_keys', { action }).then(() => true, () => false) ?? Promise.resolve(false);

/** Answers the right-click menu with the command chosen in it, or with none (`null`). */
export const chooseDesktopContextMenu = (id: number, command: number | null): void => {
  void tauri()?.invoke('context_menu_choose', { id, command }).catch(() => undefined);
};

/** The window's own commands for the strip's menus: closing it, full screen, and quitting the app. */
export const runDesktopCommand = (command: 'window_close' | 'window_fullscreen' | 'app_quit'): void => {
  void tauri()?.invoke(command).catch(() => undefined);
};

/** Whether the app's window shows Windows 11's Mica through the frame around the page (tabs.rs). */
export const desktopHasMica = (): boolean =>
  typeof window !== 'undefined' && (window as Window & { __WILLOW_MATERIAL__?: string | null }).__WILLOW_MATERIAL__ === 'mica';

/**
 * Raises Willow's window if asked, and has the tab in front open a Spark task or
 * focus its composer (it hears this as a `pets-show` message).
 */
export const showInDesktopTab = (request: { taskId?: string; composer?: boolean; raise: boolean }): void => {
  void tauri()
    ?.invoke('pets_show', { taskId: request.taskId ?? null, composer: request.composer === true, raise: request.raise })
    .catch(() => undefined);
};
