/**
 * Willow's desktop app shows this page in its agent tabs (Willow's `features/harness`). There
 * it stands in for T3's Electron preload: `window.desktopBridge`, from what Willow's page puts
 * in the address fragment (the server's bootstrap token, the agent the tab is for, the theme)
 * and from Willow's page over `postMessage` for what only the desktop app can do.
 *
 * It must be installed before any module reads `window.desktopBridge`, so this file imports
 * nothing that does: what it needs from the app is imported when called.
 */
import type {
  AdvertisedEndpoint,
  ClientSettings,
  ContextMenuItem,
  DesktopBridge,
  DesktopEnvironmentBootstrap,
  DesktopPendingSnapShot,
  DesktopServerExposureState,
  DesktopSnapShot,
  DesktopSnapShotEvent,
  DesktopSnapShotShortcutAvailability,
  DesktopSnapShotState,
  DesktopSshPasswordPromptRequest,
  DesktopUpdateState,
  DesktopWslState,
} from "@t3tools/contracts";

import { createWillowPreview, receiveNativePreview, type NativePreviewRequest } from "./preview";
import { setWillowViewport } from "./viewport";

const SOURCE = "willow-agents";
const INIT_KEY = "willow-agents:init";
const CLIENT_SETTINGS_KEY = "willow-agents:client-settings";
/** Set once these settings have been given Willow's panel motion; from then on it is the user's. */
const PANEL_MOTION_KEY = "willow-agents:panel-motion";
/** Set once the workspace row has been kept over the box in every thread; then it is the user's. */
const COMPOSER_CONTEXT_KEY = "willow-agents:composer-context";
/** Willow's sidebar and side panels slide over 300ms (its Sidebar.tsx and ChatView). */
const WILLOW_PANEL_MOTION_MS = 300;
const CONNECTION_CATALOG_KEY = "willow-agents:connection-catalog";
/** "off" when the agent tabs use remote environments only, as T3's desktop app can. */
const LOCAL_ENVIRONMENT_KEY = "willow-agents:local-environment";
const PRIMARY_ID = "primary";
/** T3's project icon formats (`WORKSPACE_IMAGE_PREVIEW_EXTENSIONS`), as its desktop picker filters them. */
const PROJECT_ICON_EXTENSIONS = ["avif", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"];

/** Accents derived from the tab's agent's colour (Willow's features/harness harness-theme.ts). */
export interface WillowPalette {
  glow: string;
  glowLight: string;
  /** The glow behind a new thread's prompt box in dark theme. */
  glowDesktop?: string;
  /** That glow at Willow's compact width, rising from the bottom. */
  glowMobile?: string;
  send: string;
  sendHover: string;
  sendLight: string;
  sendLightHover: string;
  chip: string;
  toggleTrack: string;
  toggleThumb: string;
  accent: string;
  accentHover: string;
  loadbar: string;
}

export interface WillowInit {
  /** The server's desktop bootstrap token, exchanged here for a bearer session. */
  token: string;
  /** The agent the tab is for: T3's provider driver kind. */
  driver: string;
  isLight: boolean;
  palette?: WillowPalette;
  /** Willow's desktop app shows the preview's pages in webviews of their own (on Windows). */
  nativePreview?: boolean;
  /** Willow's desktop app draws the side panel's tabs in the strip across its window, over the panel. */
  stripTabs?: boolean;
  /** Willow's window width, by which this page takes Willow's breakpoints (willow/viewport.ts). */
  viewportWidth?: number;
}

/** One of the side panel's tabs as Willow's strip draws it (its desktop-bridge `StripPanelTab`). */
export interface WillowPanelTab {
  id: string;
  title: string;
  active: boolean;
  pending?: boolean;
  /** The site's icon, by address. */
  image?: string;
  /** The tab's glyph as a PNG mask, which the strip fills with its own text colour. */
  mask?: string;
}

/** What was done in the strip to one of the side panel's tabs, or its +, at `left`–`right` in this page's pixels. */
export interface WillowPanelTabAction {
  action: "select" | "close" | "add" | "menu";
  id: string | null;
  left: number;
  right: number;
}

const PANEL_TAB_ACTIONS: ReadonlySet<string> = new Set(["select", "close", "add", "menu"]);

const PALETTE_VARIABLES: Record<keyof WillowPalette, string> = {
  glow: "--willow-glow",
  glowLight: "--willow-glow-light",
  glowDesktop: "--willow-glow-desktop",
  glowMobile: "--willow-glow-mobile",
  send: "--willow-send",
  sendHover: "--willow-send-hover",
  sendLight: "--willow-send-light",
  sendLightHover: "--willow-send-light-hover",
  chip: "--willow-chip",
  toggleTrack: "--willow-toggle-track",
  toggleThumb: "--willow-toggle-thumb",
  accent: "--willow-accent",
  accentHover: "--willow-accent-hover",
  loadbar: "--willow-loadbar",
};

const applyPalette = (palette: WillowPalette | undefined) => {
  if (!palette) return;
  const style = document.documentElement.style;
  for (const [key, variable] of Object.entries(PALETTE_VARIABLES)) {
    const value = palette[key as keyof WillowPalette];
    if (typeof value === "string" && CSS.supports("color", value))
      style.setProperty(variable, value);
  }
};

const APPEARANCE_KEY = "t3code:theme-appearance-mode";

const applyAppearance = (isLight: boolean) => {
  const mode = isLight ? "light" : "dark";
  if (localStorage.getItem(APPEARANCE_KEY) === mode) return;
  localStorage.setItem(APPEARANCE_KEY, mode);
  // T3's theme follows storage events, which a page's own writes do not fire.
  window.dispatchEvent(
    new StorageEvent("storage", { key: APPEARANCE_KEY, newValue: mode, storageArea: localStorage }),
  );
};

type Listener<T> = (value: T) => void;

/** What Willow's page has said: the tab's agent and the theme, as they change. */
export interface WillowEmbed {
  init: WillowInit;
  scope: () => string;
  isLight: () => boolean;
  onScope: (listener: Listener<string>) => () => void;
  onTheme: (listener: Listener<boolean>) => () => void;
  ready: () => void;
  /** Hands Willow's strip the side panel's tabs, from the panel's left edge in this page, or none. */
  reportPanelTabs: (
    report: { left: number; tabs: readonly WillowPanelTab[]; add: boolean } | null,
  ) => void;
  onPanelTab: (listener: Listener<WillowPanelTabAction>) => () => void;
}

declare global {
  interface Window {
    __WILLOW_AGENTS__?: WillowEmbed;
  }
}

const readInit = (): WillowInit | null => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const raw = params.get("willow");
  if (raw) {
    try {
      const init = JSON.parse(raw) as WillowInit;
      if (typeof init.token === "string" && init.token.length > 0) {
        sessionStorage.setItem(INIT_KEY, JSON.stringify(init));
        // The router reads the fragment, and the token has no business in the address bar.
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}`,
        );
        return init;
      }
    } catch {
      // Not Willow's.
    }
  }
  try {
    const saved = sessionStorage.getItem(INIT_KEY);
    return saved ? (JSON.parse(saved) as WillowInit) : null;
  } catch {
    return null;
  }
};

const readJson = <T>(key: string): T | null => {
  try {
    const text = localStorage.getItem(key);
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
};

let requestCount = 0;
const pending = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

/** Asks Willow's page for something only the desktop app can do. */
const askWillow = <T>(method: string, ...args: unknown[]): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const id = `${Date.now()}-${++requestCount}`;
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    window.parent.postMessage({ source: SOURCE, kind: "request", id, method, args }, "*");
  });

const updateState = (): DesktopUpdateState => ({
  enabled: false,
  status: "disabled",
  channel: "latest",
  currentVersion: "willow",
  hostArch: "x64",
  appArch: "x64",
  runningUnderArm64Translation: false,
  availableVersion: null,
  downloadedVersion: null,
  releaseNotes: [],
  omittedReleaseCount: 0,
  downloadPercent: null,
  checkedAt: null,
  message: "The agents update with Willow.",
  errorContext: null,
  canRetry: false,
});

const wslState = (): DesktopWslState => ({
  enabled: false,
  distro: null,
  available: false,
  wslOnly: false,
  distros: [],
  preflightError: null,
});

/** What Willow reports of the server's network access: T3's state, and the port it is served on. */
type WillowExposure = DesktopServerExposureState & { port: number | null };

const exposureState = ({ port: _port, ...state }: WillowExposure): DesktopServerExposureState =>
  state;

/** The endpoints T3's desktop advertises (its DesktopServerExposure.ts and tailscaleEndpointProvider.ts). */
const advertisedEndpoints = async (
  exposure: WillowExposure,
  tailscale: { dnsName: string | null; ipv4: string | null } | null,
): Promise<AdvertisedEndpoint[]> => {
  if (exposure.port === null) return [];
  const { createAdvertisedEndpoint } = await import("@t3tools/shared/advertisedEndpoint");
  const desktop = { id: "desktop-core", label: "Desktop", kind: "core", isAddon: false } as const;
  const tailnet = {
    id: "tailscale",
    label: "Tailscale",
    kind: "private-network",
    isAddon: true,
  } as const;
  const endpoints: AdvertisedEndpoint[] = [
    createAdvertisedEndpoint({
      id: `desktop-loopback:${exposure.port}`,
      label: "This machine",
      provider: desktop,
      source: "desktop-core",
      httpBaseUrl: `http://127.0.0.1:${exposure.port}`,
      reachability: "loopback",
      status: "available",
      description: "Loopback endpoint for this desktop app.",
    }),
  ];
  if (exposure.endpointUrl) {
    endpoints.push(
      createAdvertisedEndpoint({
        id: `desktop-lan:${exposure.endpointUrl}`,
        label: "Local network",
        provider: desktop,
        source: "desktop-core",
        httpBaseUrl: exposure.endpointUrl,
        reachability: "lan",
        status: "available",
        isDefault: true,
        description: "Reachable from devices on the same network.",
      }),
    );
  }
  if (exposure.mode === "network-accessible" && tailscale?.ipv4) {
    endpoints.push(
      createAdvertisedEndpoint({
        id: `tailscale-ip:http://${tailscale.ipv4}:${exposure.port}`,
        label: "Tailscale IP",
        provider: tailnet,
        source: "desktop-addon",
        httpBaseUrl: `http://${tailscale.ipv4}:${exposure.port}`,
        reachability: "private-network",
        status: "available",
        description: "Reachable from devices on the same Tailnet.",
      }),
    );
  }
  if (tailscale?.dnsName) {
    const port = exposure.tailscaleServePort;
    const httpBaseUrl = `https://${tailscale.dnsName}${port === 443 ? "" : `:${port}`}`;
    endpoints.push(
      createAdvertisedEndpoint({
        id: `tailscale-magicdns:${httpBaseUrl}`,
        label: "Tailscale HTTPS",
        provider: tailnet,
        source: "desktop-addon",
        httpBaseUrl,
        reachability: "private-network",
        hostedHttpsCompatibility: exposure.tailscaleServeEnabled
          ? "compatible"
          : "requires-configuration",
        status: exposure.tailscaleServeEnabled ? "unknown" : "unavailable",
        description: exposure.tailscaleServeEnabled
          ? "HTTPS endpoint served by Tailscale Serve."
          : "MagicDNS hostname. Configure Tailscale Serve for HTTPS access.",
      }),
    );
  }
  return endpoints;
};

/**
 * T3 notifies with the page's `Notification`, which a frame cannot show; in Willow its
 * notifications are Willow's own. Permission is Willow's, read once and on each request.
 */
const installNotifications = () => {
  let permission: NotificationPermission = "default";
  void askWillow<boolean>("notificationsAllowed").then(
    (allowed) => {
      permission = allowed ? "granted" : "default";
    },
    () => {},
  );
  class WillowNotification extends EventTarget {
    static get permission(): NotificationPermission {
      return permission;
    }
    static async requestPermission(): Promise<NotificationPermission> {
      permission = (await askWillow<boolean>("requestNotifications").catch(() => false))
        ? "granted"
        : "denied";
      return permission;
    }
    readonly title: string;
    onclick: ((event: Event) => void) | null = null;
    constructor(title: string, options?: NotificationOptions) {
      super();
      this.title = title;
      void askWillow("notify", { title, body: options?.body ?? "", tag: options?.tag }).catch(
        () => {},
      );
    }
    close() {}
  }
  Object.defineProperty(window, "Notification", {
    configurable: true,
    writable: true,
    value: WillowNotification,
  });
};

const noSubscription = () => () => {};

interface RemoteModules {
  readonly authorization: typeof import("@t3tools/client-runtime/authorization");
  readonly environment: typeof import("@t3tools/client-runtime/environment");
  readonly contracts: typeof import("@t3tools/contracts");
}

type RemoteEffect<A, E> = import("effect/Effect").Effect<
  A,
  E,
  import("effect/http").HttpClient.HttpClient
>;

type RemoteOutcome<A, E> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E };

/** Runs one of T3's remote-API calls from this page, over `fetch` without credentials. */
async function runRemote<A, E>(
  call: (modules: RemoteModules) => RemoteEffect<A, E>,
): Promise<RemoteOutcome<A, E>> {
  const [
    authorization,
    environment,
    contracts,
    { layerRemoteHttpClient },
    Effect,
    Layer,
    { FetchHttpClient },
  ] = await Promise.all([
    import("@t3tools/client-runtime/authorization"),
    import("@t3tools/client-runtime/environment"),
    import("@t3tools/contracts"),
    import("@t3tools/client-runtime/rpc"),
    import("effect/Effect"),
    import("effect/Layer"),
    import("effect/http"),
  ]);
  const http = Layer.merge(
    layerRemoteHttpClient(globalThis.fetch),
    Layer.succeed(FetchHttpClient.RequestInit, { credentials: "omit" }),
  );
  const outcome = call({ authorization, environment, contracts }).pipe(
    Effect.match({
      onFailure: (error): RemoteOutcome<A, E> => ({ ok: false, error }),
      onSuccess: (value): RemoteOutcome<A, E> => ({ ok: true, value }),
    }),
    Effect.provide(http),
  ) as import("effect/Effect").Effect<RemoteOutcome<A, E>>;
  return Effect.runPromise(outcome);
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** The HTTP status a remote failure stands for, as T3's desktop app reads it. */
function remoteStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const failure = error as { readonly _tag?: string; readonly status?: unknown };
  if (typeof failure.status === "number") return failure.status;
  switch (failure._tag) {
    case "EnvironmentRequestInvalidError":
      return 400;
    case "EnvironmentAuthInvalidError":
      return 401;
    case "EnvironmentScopeRequiredError":
    case "EnvironmentOperationForbiddenError":
      return 403;
    case "EnvironmentInternalError":
      return 500;
    default:
      return null;
  }
}

export function installWillowBridge(): WillowEmbed | null {
  if (typeof window === "undefined" || window.parent === window) return null;
  const init = readInit();
  if (!init) return null;

  let scope = init.driver;
  let isLight = init.isLight;
  const scopeListeners = new Set<Listener<string>>();
  const themeListeners = new Set<Listener<boolean>>();
  const snapShotListeners = new Set<Listener<DesktopSnapShotEvent>>();
  const panelTabListeners = new Set<Listener<WillowPanelTabAction>>();
  applyAppearance(isLight);
  applyPalette(init.palette);
  setWillowViewport(init.viewportWidth);
  const remember = (patch: Partial<WillowInit>) => {
    Object.assign(init, patch);
    try {
      sessionStorage.setItem(INIT_KEY, JSON.stringify(init));
    } catch {
      // A reload falls back to the first theme it was given.
    }
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data as {
      source?: string;
      kind?: string;
      id?: string;
      ok?: boolean;
      value?: unknown;
      error?: string;
      driver?: string;
      isLight?: boolean;
      palette?: WillowPalette;
      event?: DesktopSnapShotEvent;
      state?: unknown;
      focused?: boolean;
      action?: string;
      left?: number;
      right?: number;
      width?: number;
    } | null;
    if (!data || data.source !== SOURCE) return;
    if (data.kind === "response" && typeof data.id === "string") {
      const waiting = pending.get(data.id);
      pending.delete(data.id);
      if (data.ok) waiting?.resolve(data.value);
      else waiting?.reject(new Error(data.error ?? "Willow could not do that."));
    } else if (data.kind === "scope" && typeof data.driver === "string") {
      scope = data.driver;
      remember({ driver: scope });
      for (const listener of scopeListeners) listener(scope);
    } else if (data.kind === "theme" && typeof data.isLight === "boolean") {
      isLight = data.isLight;
      applyAppearance(isLight);
      applyPalette(data.palette);
      remember({ isLight, ...(data.palette ? { palette: data.palette } : {}) });
      for (const listener of themeListeners) listener(isLight);
    } else if (data.kind === "snapshot" && data.event) {
      for (const listener of snapShotListeners) listener(data.event);
    } else if (data.kind === "preview" && typeof data.id === "string") {
      receiveNativePreview(data.id, data.state, data.focused === true);
    } else if (data.kind === "viewport" && typeof data.width === "number") {
      setWillowViewport(data.width);
      remember({ viewportWidth: data.width });
    } else if (data.kind === "panel-tab" && data.action && PANEL_TAB_ACTIONS.has(data.action)) {
      const action: WillowPanelTabAction = {
        action: data.action as WillowPanelTabAction["action"],
        id: typeof data.id === "string" ? data.id : null,
        left: typeof data.left === "number" ? data.left : 0,
        right: typeof data.right === "number" ? data.right : 0,
      };
      for (const listener of panelTabListeners) listener(action);
    }
  });

  /** The capture settings Willow's desktop app watches the keyboard by (its snapshots.rs). */
  const configureSnapShot = (settings: ClientSettings | null) =>
    askWillow<DesktopSnapShotState>("snapShotConfigure", {
      enabled: settings?.snapShotEnabled === true,
      shortcut: settings?.snapShotShortcut ?? { kind: "both-shift-keys" },
      includeAccessibility: settings?.snapShotIncludeAccessibility !== false,
    });
  void configureSnapShot(readJson<ClientSettings>(CLIENT_SETTINGS_KEY)).catch(() => undefined);

  const httpBaseUrl = `${window.location.origin}/`;
  const wsBaseUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/`;
  const bootstraps: readonly DesktopEnvironmentBootstrap[] = [
    { id: PRIMARY_ID, label: "This computer", httpBaseUrl, wsBaseUrl, bootstrapToken: init.token },
  ];

  let bearer: Promise<string> | null = null;
  const exchangeToken = async (): Promise<string> => {
    const outcome = await runRemote(({ authorization, contracts }) =>
      authorization.bootstrapRemoteBearerSession({
        httpBaseUrl,
        credential: init.token,
        scopes: contracts.AuthStandardClientScopes,
        clientMetadata: { label: "Willow", deviceType: "desktop" },
      }),
    );
    if (!outcome.ok)
      throw outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error));
    return outcome.value.access_token;
  };

  /** This server keeps Willow's SSH environments (`apps/server/src/willow/ssh.ts`), for this page only. */
  const ssh = async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${httpBaseUrl}api/willow/ssh/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", "x-willow-desktop": init.token },
      credentials: "omit",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = (await response.json().catch(() => null)) as {
      ok?: boolean;
      value?: T;
      error?: string;
    } | null;
    if (!result?.ok)
      throw new Error(result?.error ?? `The SSH request failed (${response.status}).`);
    return result.value as T;
  };

  // Password prompts are asked for while a connection is being made, the only time ssh asks.
  const promptListeners = new Set<(request: DesktopSshPasswordPromptRequest) => void>();
  const promptsSeen = new Set<string>();
  let connecting = 0;
  let promptPoll: number | undefined;
  const pollPrompts = async () => {
    try {
      for (const request of await ssh<DesktopSshPasswordPromptRequest[]>("prompts")) {
        if (promptsSeen.has(request.requestId)) continue;
        promptsSeen.add(request.requestId);
        for (const listener of promptListeners) listener(request);
      }
    } catch {
      // The next poll asks again.
    }
    promptPoll = connecting > 0 ? window.setTimeout(pollPrompts, 700) : undefined;
  };
  const whileConnecting = async <T>(work: () => Promise<T>): Promise<T> => {
    connecting += 1;
    promptPoll ??= window.setTimeout(pollPrompts, 300);
    try {
      return await work();
    } finally {
      connecting -= 1;
    }
  };

  /** One of T3's requests to an SSH environment's tunnelled server, failing as its desktop app's do. */
  const sshRemote = async <A, E>(
    operation: string,
    remoteBaseUrl: string,
    call: (modules: RemoteModules, httpBaseUrl: string) => RemoteEffect<A, E>,
  ): Promise<A> => {
    const url = new URL(remoteBaseUrl);
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      throw new Error(
        `SSH remote API request failed during ${operation}: ${url.host} is not this computer.`,
      );
    }
    const outcome = await runRemote((modules) => call(modules, url.href));
    if (outcome.ok) return outcome.value;
    const status = remoteStatus(outcome.error);
    throw new Error(
      `${status === null ? "" : `[ssh_http:${status}] `}SSH remote API request failed during ${operation}.`,
    );
  };

  installNotifications();

  const localEnvironmentEnabled = () => localStorage.getItem(LOCAL_ENVIRONMENT_KEY) !== "off";

  /** T3's badge drawing (a data URL) as the RGBA pixels Willow's taskbar overlay takes. */
  const badgePixels = async (url: string): Promise<{ rgba: number[]; size: number } | null> => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, size, size);
    return { rgba: Array.from(context.getImageData(0, 0, size, size).data), size };
  };

  const bridge: DesktopBridge = {
    getAppBranding: () => ({ baseName: "Willow", stageLabel: "Alpha", displayName: "Willow" }),
    setNotificationBadge: async ({ count, image }) => {
      const icon = count > 0 && image ? await badgePixels(image).catch(() => null) : null;
      await askWillow("setBadge", { count, ...(icon ?? {}) });
    },
    getClientPlatform: () =>
      navigator.userAgent.includes("Windows")
        ? "win32"
        : navigator.userAgent.includes("Mac")
          ? "darwin"
          : "linux",
    getSystemLocale: () => navigator.language || null,
    getLocalEnvironmentBootstraps: () => (localEnvironmentEnabled() ? bootstraps : []),
    getLocalEnvironmentEnabled: localEnvironmentEnabled,
    // T3's desktop app relaunches without its server. Here the server also serves this page, so
    // it stays, restarted on loopback: what ran on it stops and other devices lose it.
    setLocalEnvironmentEnabled: async (enabled) => {
      if (enabled) {
        localStorage.removeItem(LOCAL_ENVIRONMENT_KEY);
      } else {
        await askWillow("setServerExposure", "local-only");
        localStorage.setItem(LOCAL_ENVIRONMENT_KEY, "off");
      }
      window.location.reload();
    },
    getLocalEnvironmentBearerToken: () => {
      bearer ??= exchangeToken().catch((error: unknown) => {
        bearer = null;
        throw error;
      });
      return bearer;
    },
    getClientSettings: async () => {
      const settings = readJson<ClientSettings>(CLIENT_SETTINGS_KEY);
      const hasMotion = localStorage.getItem(PANEL_MOTION_KEY) !== null;
      const hasComposerContext = localStorage.getItem(COMPOSER_CONTEXT_KEY) !== null;
      if (hasMotion && hasComposerContext) return settings;
      // T3 ships with its panels' motion off and its workspace row on new chats alone; Willow's
      // panels slide, and the row stays over the box in every thread.
      const { DEFAULT_CLIENT_SETTINGS } = await import("@t3tools/contracts/settings");
      const migrated: ClientSettings = {
        ...(settings ?? DEFAULT_CLIENT_SETTINGS),
        ...(hasMotion ? {} : { panelAnimationDurationMs: WILLOW_PANEL_MOTION_MS }),
        ...(hasComposerContext ? {} : { persistComposerContextStrip: true }),
      };
      localStorage.setItem(CLIENT_SETTINGS_KEY, JSON.stringify(migrated));
      localStorage.setItem(PANEL_MOTION_KEY, "1");
      localStorage.setItem(COMPOSER_CONTEXT_KEY, "1");
      return migrated;
    },
    setClientSettings: async (settings) => {
      localStorage.setItem(CLIENT_SETTINGS_KEY, JSON.stringify(settings));
      // Settings read the capture state right after saving, so the shortcut is armed first.
      await configureSnapShot(settings).catch(() => undefined);
    },
    getConnectionCatalog: async () => localStorage.getItem(CONNECTION_CATALOG_KEY),
    setConnectionCatalog: async (catalog) => {
      localStorage.setItem(CONNECTION_CATALOG_KEY, catalog);
      return true;
    },
    clearConnectionCatalog: async () => {
      localStorage.removeItem(CONNECTION_CATALOG_KEY);
    },
    discoverSshHosts: () => ssh("discover", {}),
    resolveSshHost: (alias) => ssh("resolve", { alias }),
    ensureSshEnvironment: (target, options) =>
      whileConnecting(() =>
        ssh("ensure", { target, issuePairingToken: options?.issuePairingToken === true }),
      ),
    disconnectSshEnvironment: (target) => whileConnecting(() => ssh("disconnect", { target })),
    fetchSshEnvironmentDescriptor: (remoteBaseUrl) =>
      sshRemote("fetch-environment-descriptor", remoteBaseUrl, ({ environment }, url) =>
        environment.fetchRemoteEnvironmentDescriptor({ httpBaseUrl: url }),
      ),
    bootstrapSshBearerSession: (remoteBaseUrl, credential) =>
      sshRemote("bootstrap-bearer-session", remoteBaseUrl, ({ authorization }, url) =>
        authorization.bootstrapRemoteBearerSession({ httpBaseUrl: url, credential }),
      ),
    fetchSshSessionState: (remoteBaseUrl, bearerToken) =>
      sshRemote("fetch-session-state", remoteBaseUrl, ({ authorization }, url) =>
        authorization.fetchRemoteSessionState({ httpBaseUrl: url, bearerToken }),
      ),
    issueSshWebSocketTicket: (remoteBaseUrl, bearerToken) =>
      sshRemote("issue-websocket-ticket", remoteBaseUrl, ({ authorization }, url) =>
        authorization.issueRemoteWebSocketTicket({ httpBaseUrl: url, bearerToken }),
      ),
    onSshPasswordPrompt: (listener) => {
      promptListeners.add(listener);
      return () => {
        promptListeners.delete(listener);
      };
    },
    resolveSshPasswordPrompt: async (requestId, password) => {
      await ssh("prompts/answer", { requestId, password });
    },
    getServerExposureState: async () =>
      exposureState(await askWillow<WillowExposure>("getServerExposure")),
    setServerExposureMode: async (mode) =>
      exposureState(await askWillow<WillowExposure>("setServerExposure", mode)),
    setTailscaleServeEnabled: async (input) =>
      exposureState(await askWillow<WillowExposure>("setTailscaleServe", input)),
    getAdvertisedEndpoints: async () => {
      const [exposure, tailscale] = await Promise.all([
        askWillow<WillowExposure>("getServerExposure"),
        askWillow<{ dnsName: string | null; ipv4: string | null } | null>("getTailscale").catch(
          () => null,
        ),
      ]);
      return advertisedEndpoints(exposure, tailscale);
    },
    getSnapShotState: () => askWillow<DesktopSnapShotState>("snapShotState"),
    // Windows asks for no permission to read the window in front.
    requestSnapShotPermissions: async () => {},
    checkSnapShotShortcut: (shortcut) =>
      askWillow<DesktopSnapShotShortcutAvailability>("snapShotCheckShortcut", shortcut),
    setSnapShotShortcutSuppressed: (suppressed) => askWillow<void>("snapShotSuppress", suppressed),
    listPendingSnapShots: () => askWillow<readonly DesktopPendingSnapShot[]>("snapShotPending"),
    readSnapShot: (id) => askWillow<DesktopSnapShot>("snapShotRead", id),
    acknowledgeSnapShot: (id) => askWillow<void>("snapShotAck", id),
    onSnapShotEvent: (listener) => {
      snapShotListeners.add(listener);
      return () => {
        snapShotListeners.delete(listener);
      };
    },
    getWslState: async () => wslState(),
    setWslBackendEnabled: async () => wslState(),
    setWslDistro: async () => wslState(),
    setWslOnly: async () => wslState(),
    // A picked path only means something to the server on this computer.
    pickFolder: async (options) =>
      localEnvironmentEnabled()
        ? askWillow<string | null>("pickFolder", { title: "Add a project", ...(options ?? {}) })
        : null,
    pickProjectFavicon: async (initialPath) =>
      localEnvironmentEnabled()
        ? askWillow<string | null>("pickFile", {
            title: "Choose a project icon",
            filters: [{ name: "Images", extensions: PROJECT_ICON_EXTENSIONS }],
            ...(initialPath ? { defaultPath: initialPath } : {}),
          })
        : null,
    setTheme: async () => {},
    showContextMenu: async <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => {
      const { showContextMenuFallback } = await import("../contextMenuFallback");
      return showContextMenuFallback(items, position);
    },
    openExternal: async (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
      return true;
    },
    onMenuAction: noSubscription,
    getWindowFullscreenState: () => false,
    onWindowFullscreenStateChange: noSubscription,
    getUpdateState: async () => updateState(),
    setUpdateChannel: async () => updateState(),
    checkForUpdate: async () => ({ checked: false, state: updateState() }),
    downloadUpdate: async () => ({ accepted: false, completed: false, state: updateState() }),
    installUpdate: async () => ({ accepted: false, completed: false, state: updateState() }),
    onUpdateState: noSubscription,
    preview: createWillowPreview(
      init.nativePreview === true
        ? (request: NativePreviewRequest) => askWillow<void>("preview", request)
        : null,
    ),
  };
  window.desktopBridge = bridge;

  const embed: WillowEmbed = {
    init,
    scope: () => scope,
    isLight: () => isLight,
    onScope: (listener) => {
      scopeListeners.add(listener);
      return () => scopeListeners.delete(listener);
    },
    onTheme: (listener) => {
      themeListeners.add(listener);
      return () => themeListeners.delete(listener);
    },
    ready: () => window.parent.postMessage({ source: SOURCE, kind: "ready" }, "*"),
    reportPanelTabs: (report) =>
      window.parent.postMessage(
        { source: SOURCE, kind: "panel-tabs", ...(report ?? { left: 0, tabs: null, add: false }) },
        "*",
      ),
    onPanelTab: (listener) => {
      panelTabListeners.add(listener);
      return () => panelTabListeners.delete(listener);
    },
  };
  window.__WILLOW_AGENTS__ = embed;
  return embed;
}
