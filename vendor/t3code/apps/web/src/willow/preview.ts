/**
 * T3's preview browser in Willow's agent tabs. T3's desktop app shows each preview tab in an
 * Electron `<webview>` its main process drives. Willow's desktop app on Windows gives each tab a
 * webview of its own laid over this page, where `HostedBrowserWebview` marks it
 * (`attachPreviewSurface`): this module tells Willow's page where, with what this page draws over
 * it there, drives it, and reports what it shows. Elsewhere a tab is an iframe this module drives
 * (`attachPreviewFrame`), in which sites that refuse to be framed stay blank. Either way it opens
 * and reloads pages, zooms, and reports each load to T3's preview state the way the desktop app
 * reports its webview's. A webview keeps its own history; a frame keeps the tab's history of the
 * pages it opened (links followed inside a page stay that page's own).
 *
 * What only T3's webview can do — developer tools, screenshots, recordings, the element picker,
 * agent automation, cookie import — is refused with the reason.
 */
import type {
  DesktopPreviewBridge,
  DesktopPreviewNavStatus,
  DesktopPreviewTabState,
} from "@t3tools/contracts";

/** An area of this page, in its CSS pixels, with its corners' radius. */
export interface NativePreviewArea {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

/** What Willow's page is asked for a tab's webview (Willow's features/harness harness-preview.ts). */
export type NativePreviewRequest =
  | { action: "open"; id: string; url: string }
  | {
      action: "place";
      id: string;
      bounds: NativePreviewArea | null;
      holes: NativePreviewArea[];
      zoom: number;
    }
  | { action: "back" | "forward" | "reload" | "stop" | "close"; id: string }
  | { action: "closeAll" };

/** What a tab's webview shows, from Willow's page. */
interface NativePreviewState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  failed: { code: number; description: string } | null;
}

interface SurfaceLook {
  visible: boolean;
  zoom: number;
  radius: number;
}

interface Tab {
  state: DesktopPreviewTabState;
  history: string[];
  index: number;
  frame: HTMLIFrameElement | null;
  /** Where the tab's webview goes, and how it is shown there. */
  surface: HTMLElement | null;
  look: SurfaceLook;
  /** Whether the webview has been given a page, and the placement it was last given. */
  opened: boolean;
  placed: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

const tabs = new Map<string, Tab>();
const stateListeners = new Set<(tabId: string, state: DesktopPreviewTabState) => void>();
let native: ((request: NativePreviewRequest) => Promise<void>) | null = null;

/** A previewed page's frame: no top navigation, so a page cannot move Willow's own. */
export const PREVIEW_FRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock";
export const PREVIEW_FRAME_ALLOW = "clipboard-read; clipboard-write; fullscreen";

/**
 * T3's mini player shows a tab over the conversation while the panel is closed, in a slot of its
 * own (`BrowserSurfaceSlot`, for T3's Electron views): the tab's webview goes there instead, or,
 * without webviews, a frame of the tab put in it here.
 */
const playerSlot = (tabId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(
    `[data-preview-mini-player] [data-browser-surface-slot="${CSS.escape(tabId)}"]`,
  );
const playerFrames = new Map<
  string,
  { slot: HTMLElement; frame: HTMLIFrameElement; detach: () => void }
>();

/** Whether a tab has a page to show: what T3's mini player waits for before it shows the tab. */
export const previewShowsPage = (tabId: string): boolean => {
  const tab = tabs.get(tabId);
  return tab !== undefined && tab.state.navStatus.kind !== "Idle";
};

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/** What this page draws over a tab: its menus, popovers, tooltips, dialogs and toasts. */
const OVER_PREVIEW = [
  '[data-slot$="-popup"]',
  '[data-slot$="-backdrop"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="tooltip"]',
  "[data-willow-over-preview]",
].join(", ");

/** How long after this page changes its surfaces are followed every frame: their opening motion. */
const FOLLOW_MS = 400;

const unavailable = (what: string): Promise<never> =>
  Promise.reject(new Error(`${what} needs T3's desktop browser; Willow's preview cannot do it.`));

/** Whether a tab here is a webview of its own over this page, rather than a frame in it. */
export const previewHasWebviews = (): boolean => native !== null;

const ask = (request: NativePreviewRequest) => {
  void native?.(request).catch(() => undefined);
};

const pageTitle = (frame: HTMLIFrameElement | null, url: string): string => {
  try {
    const title = frame?.contentDocument?.title;
    if (title) return title;
  } catch {
    // A page from another origin keeps its title to itself.
  }
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

function emit(tab: Tab, patch: Partial<DesktopPreviewTabState> = {}) {
  tab.state = {
    ...tab.state,
    ...patch,
    canGoBack: native ? tab.canGoBack : tab.index > 0,
    canGoForward: native ? tab.canGoForward : tab.index < tab.history.length - 1,
    updatedAt: new Date().toISOString(),
  };
  for (const listener of stateListeners) listener(tab.state.tabId, tab.state);
}

function tabFor(tabId: string): Tab {
  let tab = tabs.get(tabId);
  if (!tab) {
    tab = {
      state: {
        tabId,
        webContentsId: null,
        navStatus: { kind: "Idle" },
        canGoBack: false,
        canGoForward: false,
        zoomFactor: 1,
        pictureInPicture: false,
        colorScheme: "system",
        audioMuted: false,
        audible: false,
        controller: "none",
        updatedAt: new Date().toISOString(),
      },
      history: [],
      index: -1,
      frame: null,
      surface: null,
      look: { visible: false, zoom: 1, radius: 0 },
      opened: false,
      placed: "",
      canGoBack: false,
      canGoForward: false,
    };
    tabs.set(tabId, tab);
  }
  return tab;
}

const currentUrl = (tab: Tab): string | null => tab.history[tab.index] ?? null;

function show(tab: Tab, url: string) {
  const status: DesktopPreviewNavStatus = { kind: "Loading", url, title: pageTitle(null, url) };
  emit(tab, { navStatus: status });
  if (native) {
    tab.opened = true;
    ask({ action: "open", id: tab.state.tabId, url });
  } else if (tab.frame && tab.frame.src !== url) tab.frame.src = url;
}

function open(tab: Tab, url: string) {
  tab.history = [...tab.history.slice(0, tab.index + 1), url];
  tab.index = tab.history.length - 1;
  show(tab, url);
}

/**
 * The iframe showing a tab, from `HostedBrowserWebview`; null when it unmounts. It opens on the
 * tab's page, or on the page the tab was opened at (`initialUrl`, as a webview's `src`), and
 * each load it finishes is reported.
 */
export function attachPreviewFrame(
  tabId: string,
  frame: HTMLIFrameElement | null,
  initialUrl?: string | null,
): () => void {
  const tab = tabFor(tabId);
  tab.frame = frame;
  if (!frame) return () => {};
  watchPage();
  if (tab.history.length === 0 && initialUrl && initialUrl !== "about:blank") {
    tab.history = [initialUrl];
    tab.index = 0;
    emit(tab, {
      navStatus: { kind: "Loading", url: initialUrl, title: pageTitle(null, initialUrl) },
    });
  }
  const onLoad = () => {
    const url = currentUrl(tab);
    if (!url || frame.src === "about:blank") return;
    emit(tab, { navStatus: { kind: "Success", url, title: pageTitle(frame, url) } });
  };
  frame.addEventListener("load", onLoad);
  const url = currentUrl(tab);
  if (url && frame.src !== url) frame.src = url;
  return () => {
    frame.removeEventListener("load", onLoad);
    if (tab.frame === frame) tab.frame = null;
  };
}

/**
 * Where a tab's webview goes, from `HostedBrowserWebview`; null when it unmounts. It opens on the
 * tab's page, or on the page the tab was opened at (`initialUrl`, as a webview's `src`).
 */
export function attachPreviewSurface(
  tabId: string,
  surface: HTMLElement | null,
  initialUrl?: string | null,
): () => void {
  const tab = tabFor(tabId);
  tab.surface = surface;
  schedulePlacement();
  if (!surface) return () => {};
  if (!tab.opened) {
    const url = currentUrl(tab) ?? (initialUrl && initialUrl !== "about:blank" ? initialUrl : null);
    if (url) {
      if (tab.history.length === 0) {
        tab.history = [url];
        tab.index = 0;
      }
      show(tab, url);
    }
  }
  watchPage();
  const observer = new ResizeObserver(schedulePlacement);
  observer.observe(surface);
  return () => {
    observer.disconnect();
    if (tab.surface !== surface) return;
    tab.surface = null;
    schedulePlacement();
  };
}

/** Whether a tab's webview is shown where `HostedBrowserWebview` marks it, at what zoom, with what corners. */
export function placePreviewSurface(tabId: string, look: SurfaceLook) {
  tabFor(tabId).look = look;
  schedulePlacement();
}

/** What Willow's page says a tab's webview shows, or that it was clicked into. */
export function receiveNativePreview(tabId: string, state: unknown, focused: boolean) {
  const tab = tabs.get(tabId);
  if (!tab) return;
  if (focused) {
    // A click inside the page only reaches this one as this: open menus and popovers close as
    // on any press outside them.
    tab.surface?.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }),
    );
  }
  const shown = state as NativePreviewState | undefined;
  if (!shown || typeof shown.url !== "string") return;
  tab.canGoBack = shown.canGoBack === true;
  tab.canGoForward = shown.canGoForward === true;
  const title = shown.title || pageTitle(null, shown.url);
  const navStatus: DesktopPreviewNavStatus = shown.failed
    ? {
        kind: "LoadFailed",
        url: shown.url,
        title,
        code: shown.failed.code,
        description: shown.failed.description,
      }
    : { kind: shown.loading ? "Loading" : "Success", url: shown.url, title };
  emit(tab, { navStatus });
}

let placementFrame = 0;
let followUntil = 0;

function schedulePlacement() {
  if (!native || placementFrame) return;
  placementFrame = window.requestAnimationFrame(flushPlacement);
}

function followPage() {
  if (!native) {
    followPlayerFrames();
    return;
  }
  const shown = (tab: Tab) => (tab.surface && tab.look.visible) || playerSlot(tab.state.tabId);
  if (![...tabs.values()].some(shown)) return;
  followUntil = performance.now() + FOLLOW_MS;
  schedulePlacement();
}

/**
 * Without webviews, a tab in the mini player is a frame of its own there, while the panel's frame
 * is gone; it goes when the player closes or the panel shows the tab again.
 */
function followPlayerFrames() {
  for (const tab of tabs.values()) {
    const id = tab.state.tabId;
    const slot = playerSlot(id);
    const own = playerFrames.get(id);
    if (own && (own.slot !== slot || (tab.frame !== null && tab.frame !== own.frame))) {
      playerFrames.delete(id);
      own.detach();
      own.frame.remove();
    }
    if (!slot || tab.frame || playerFrames.has(id) || !currentUrl(tab)) continue;
    const player = slot.closest<HTMLElement>("[data-preview-mini-player]");
    const frame = document.createElement("iframe");
    frame.title = "Floating browser preview";
    frame.setAttribute("sandbox", PREVIEW_FRAME_SANDBOX);
    frame.setAttribute("allow", PREVIEW_FRAME_ALLOW);
    // Over the player's backdrop and under its controls; the player passes pointers through to it.
    Object.assign(frame.style, {
      position: "absolute",
      inset: "0",
      zIndex: "48",
      width: "100%",
      height: "100%",
      border: "0",
      borderRadius: player ? getComputedStyle(player).borderTopLeftRadius : "0",
      background: "#fff",
      pointerEvents: "auto",
    });
    slot.appendChild(frame);
    playerFrames.set(id, { slot, frame, detach: attachPreviewFrame(id, frame) });
  }
}

let watching = false;

/** Follows what this page opens over its tabs, and this page going away. */
function watchPage() {
  if (watching) return;
  watching = true;
  // A popup starting to close counts too, so its hole closes with it rather than once it is gone.
  new MutationObserver(followPage).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-ending-style"],
  });
  window.addEventListener("resize", schedulePlacement);
  window.addEventListener("scroll", schedulePlacement, true);
  document.addEventListener("visibilitychange", schedulePlacement);
  window.addEventListener("pagehide", () => ask({ action: "closeAll" }));
}

function flushPlacement() {
  placementFrame = 0;
  let floating = false;
  for (const tab of tabs.values()) {
    const shown = shownAt(tab);
    if (shown?.player) {
      floating = true;
      // A tab first shown in the player has its page opened there.
      const url = currentUrl(tab);
      if (!tab.opened && url) show(tab, url);
    }
    const request = placement(tab, shown);
    const key = JSON.stringify(request);
    if (key === tab.placed) continue;
    tab.placed = key;
    ask(request);
  }
  // The player is dragged and resized by its own pointer gestures, which no observer sees.
  if (floating || performance.now() < followUntil) schedulePlacement();
}

/** Where a tab shows: where `HostedBrowserWebview` marks it in the panel, else in the mini player. */
function shownAt(tab: Tab): { element: HTMLElement; radius: number; player: boolean } | null {
  if (tab.surface && tab.look.visible) {
    return { element: tab.surface, radius: tab.look.radius, player: false };
  }
  const slot = playerSlot(tab.state.tabId);
  if (!slot) return null;
  const player = slot.closest<HTMLElement>("[data-preview-mini-player]");
  const radius = Number.parseFloat(getComputedStyle(player ?? slot).borderTopLeftRadius) || 0;
  return { element: slot, radius, player: true };
}

function placement(tab: Tab, shown: ReturnType<typeof shownAt>): NativePreviewRequest {
  const id = tab.state.tabId;
  const hidden: NativePreviewRequest = {
    action: "place",
    id,
    bounds: null,
    holes: [],
    zoom: tab.look.zoom,
  };
  if (!shown || document.visibilityState === "hidden") return hidden;
  const rect = shown.element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return hidden;
  const bounds = {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    radius: shown.radius,
  };
  return { action: "place", id, bounds, holes: holesOver(tab, rect), zoom: tab.look.zoom };
}

/**
 * What this page draws over a tab, each surface once, clipped to the tab: its webview is cut
 * there, so they show over it. A tab laid out inside a sheet is only covered by what opens after
 * the sheet.
 */
function holesOver(tab: Tab, rect: DOMRect): NativePreviewArea[] {
  const slot =
    document.querySelector(`[data-browser-surface-slot="${CSS.escape(tab.state.tabId)}"]`) ??
    tab.surface;
  const home = slot?.parentElement?.closest(OVER_PREVIEW) ?? null;
  const holes: NativePreviewArea[] = [];
  for (const element of document.querySelectorAll<HTMLElement>(OVER_PREVIEW)) {
    if (slot && element.contains(slot)) continue;
    // A popup's own parts go with it; what is marked counts on its own (the mini player's pill).
    if (
      !element.hasAttribute("data-willow-over-preview") &&
      element.parentElement?.closest(OVER_PREVIEW)
    ) {
      continue;
    }
    if (home && !(home.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      continue;
    }
    // A popup on its way out goes under the tab at once: its hole would show it fading over the
    // page's dark ground.
    if (element.hasAttribute("data-ending-style")) continue;
    const box = element.getBoundingClientRect();
    const left = Math.max(box.left, rect.left);
    const top = Math.max(box.top, rect.top);
    const right = Math.min(box.right, rect.right);
    const bottom = Math.min(box.bottom, rect.bottom);
    if (right <= left || bottom <= top) continue;
    // Likewise a tooltip over the tab shows at once rather than fading in (willow/menus.css).
    if (element.dataset.slot === "tooltip-popup")
      element.setAttribute("data-willow-over-native", "");
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || Number(style.opacity) === 0) continue;
    const whole =
      left === box.left && top === box.top && right === box.right && bottom === box.bottom;
    holes.push({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      radius: whole ? Number.parseFloat(style.borderTopLeftRadius) || 0 : 0,
    });
  }
  return holes;
}

/** The tab's zoom, which `HostedBrowserWebview` lays the frame out at. */
const setZoom = (tabId: string, zoomFactor: number) => {
  emit(tabFor(tabId), { zoomFactor });
  return Promise.resolve();
};

const stepZoom = (tabId: string, direction: 1 | -1) => {
  const current = tabFor(tabId).state.zoomFactor;
  const next =
    direction > 0
      ? (ZOOM_STEPS.find((step) => step > current + 0.001) ?? ZOOM_STEPS.at(-1)!)
      : ([...ZOOM_STEPS].reverse().find((step) => step < current - 0.001) ?? ZOOM_STEPS[0]!);
  return setZoom(tabId, next);
};

const reload = (tabId: string) => {
  const tab = tabFor(tabId);
  if (native) {
    if (tab.opened) ask({ action: "reload", id: tabId });
    return Promise.resolve();
  }
  const url = currentUrl(tab);
  if (url) {
    emit(tab, { navStatus: { kind: "Loading", url, title: pageTitle(tab.frame, url) } });
    if (tab.frame) tab.frame.src = url;
  }
  return Promise.resolve();
};

/** T3's preview bridge; `host` reaches the app's webviews for the tabs, where there are any. */
export function createWillowPreview(
  host: ((request: NativePreviewRequest) => Promise<void>) | null = null,
): DesktopPreviewBridge {
  native = host;
  return {
    createTab: async (tabId, defaults) => {
      const tab = tabFor(tabId);
      emit(tab, {
        ...(defaults?.zoomFactor ? { zoomFactor: defaults.zoomFactor } : {}),
        ...(defaults?.colorScheme ? { colorScheme: defaults.colorScheme } : {}),
      });
    },
    closeTab: async (tabId) => {
      const tab = tabs.get(tabId);
      if (!tab) return;
      tabs.delete(tabId);
      if (native) ask({ action: "close", id: tabId });
      for (const listener of stateListeners) {
        listener(tabId, {
          ...tab.state,
          navStatus: { kind: "Idle" },
          updatedAt: new Date().toISOString(),
        });
      }
    },
    registerWebview: async () => {},
    navigate: async (tabId, url) => open(tabFor(tabId), url),
    goBack: async (tabId) => {
      const tab = tabFor(tabId);
      if (native) {
        ask({ action: "back", id: tabId });
        return;
      }
      if (tab.index <= 0) return;
      tab.index -= 1;
      show(tab, tab.history[tab.index]!);
    },
    goForward: async (tabId) => {
      const tab = tabFor(tabId);
      if (native) {
        ask({ action: "forward", id: tabId });
        return;
      }
      if (tab.index >= tab.history.length - 1) return;
      tab.index += 1;
      show(tab, tab.history[tab.index]!);
    },
    refresh: reload,
    hardReload: reload,
    zoomIn: (tabId) => stepZoom(tabId, 1),
    zoomOut: (tabId) => stepZoom(tabId, -1),
    resetZoom: (tabId) => setZoom(tabId, 1),
    setColorScheme: async (tabId, colorScheme) => emit(tabFor(tabId), { colorScheme }),
    setAudioMuted: async (tabId, audioMuted) => emit(tabFor(tabId), { audioMuted }),
    openDevTools: () => unavailable("Developer tools"),
    clearCookies: async () => {},
    clearCache: async () => {},
    getPreviewConfig: async () => ({
      partition: "willow-preview",
      webPreferences: "",
      preloadUrl: null,
    }),
    listBrowserImportSources: async () => [],
    importBrowserCookies: () => unavailable("Importing browser cookies"),
    setAnnotationTheme: async () => {},
    pickElement: () => unavailable("Picking an element"),
    cancelPickElement: async () => {},
    captureScreenshot: () => unavailable("A screenshot"),
    revealArtifact: async () => {},
    copyArtifactToClipboard: async () => {},
    pictureInPicture: {
      open: async (tabId) => emit(tabFor(tabId), { pictureInPicture: true }),
      close: async (tabId) => emit(tabFor(tabId), { pictureInPicture: false }),
    },
    recording: {
      onInput: () => () => {},
      startScreencast: () => unavailable("Recording"),
      stopScreencast: async () => {},
      save: () => unavailable("Recording"),
      onFrame: () => () => {},
    },
    automation: {
      status: () => unavailable("Agent browser control"),
      snapshot: () => unavailable("Agent browser control"),
      click: () => unavailable("Agent browser control"),
      type: () => unavailable("Agent browser control"),
      press: () => unavailable("Agent browser control"),
      scroll: () => unavailable("Agent browser control"),
      evaluate: () => unavailable("Agent browser control"),
      waitFor: () => unavailable("Agent browser control"),
    },
    onStateChange: (listener) => {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },
    onPointerEvent: () => () => {},
  };
}
