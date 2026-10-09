/**
 * The iframes behind Spark's remote browser, one per task.
 *
 * A frame outlives the pane that shows it. The browser agent keeps working when
 * the user closes the pane, opens another Spark page or switches tasks, so the
 * iframe is owned here rather than by React: while a pane is mounted it adopts
 * the frame into its viewer, and when the pane goes away the frame is parked in
 * a hidden layer at the end of <body>. Moves use `moveBefore`, which keeps the
 * page alive across the move; plain `appendChild` would reload it, so that is
 * only the fallback for browsers without it.
 *
 * The parked layer sits inside the viewport, under the app, at full size. That
 * is deliberate: Chrome throttles rendering of frames outside the viewport, and a
 * throttled page stops running the timers and observers that load its content.
 *
 * Pages are cross-origin to Willow (see `api/_browse-proxy.js`), so everything
 * here talks to them through the bridge script the proxy injects, over
 * postMessage.
 */

import { displayUrl, toBrowseUrl } from './browse-url';

/** The remote screen, in CSS px: Gemini's VM is 1280×1024 with an 87px Chrome frame on top. */
export const SCREEN_WIDTH = 1280;
export const SCREEN_HEIGHT = 1024;
export const CHROME_HEIGHT = 87;
export const VIEWPORT_HEIGHT = SCREEN_HEIGHT - CHROME_HEIGHT;

const TAG = '__willowBrowse';
const LAYER_ID = 'willow-remote-browser-frames';

export interface BridgeState {
  url: string;
  title: string;
  favicon: string;
  /** Chrome's throbber: true until the page's `load`. */
  loading: boolean;
  /** The document is parsed and can be read and acted on, though its subresources may still be loading. */
  parsed: boolean;
  width: number;
  height: number;
  canGoBack: boolean;
  canGoForward: boolean;
}

export type BridgeEvent =
  | ({ event: 'ready' | 'state' } & BridgeState)
  | { event: 'unload' }
  | { event: 'frame-load'; unbridged: boolean };

/** Why a call to a page with no bridge fails, worded for the browser agent. */
export const UNBRIDGED_PAGE_ERROR = 'This page cannot be controlled in the remote browser. Go back or navigate to another page.';

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface FrameEntry {
  taskId: string;
  iframe: HTMLIFrameElement;
  pending: Map<string, PendingCall>;
  listeners: Set<(event: BridgeEvent) => void>;
  state: BridgeState | null;
  /** Bumped on every new document: each bridge `ready`, and each load that had none. */
  documentVersion: number;
  /** A `ready` arrived since the frame last fired `load`. */
  readySinceLoad: boolean;
  /**
   * The document loaded without the bridge — Chrome's own error or resubmit page,
   * or its PDF or image viewer — so nothing can be asked of it.
   */
  unbridged: boolean;
  /** Where the last cross-document navigation was headed. */
  headedTo: string | null;
  /** The last page that had a bridge, which is where going back from one without goes. */
  lastBridgedUrl: string | null;
  /** A first page waiting to start loading (`loadAfterMs`); any navigation replaces it. */
  pendingLoad: ReturnType<typeof setTimeout> | null;
}

const frames = new Map<string, FrameEntry>();

const cancelPendingLoad = (entry: FrameEntry) => {
  if (entry.pendingLoad === null) return;
  clearTimeout(entry.pendingLoad);
  entry.pendingLoad = null;
};
let sequence = 0;
let listening = false;

const moveInto = (parent: Element, node: Element) => {
  if (node.parentElement === parent) return;
  const target = parent as Element & { moveBefore?: (node: Node, child: Node | null) => void };
  if (typeof target.moveBefore === 'function' && node.isConnected && parent.isConnected) {
    try {
      target.moveBefore(node, null);
      return;
    } catch {
      // Fall through to a plain move, which reloads the page.
    }
  }
  parent.appendChild(node);
};

const parkingLayer = (): HTMLElement => {
  let layer = document.getElementById(LAYER_ID);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = LAYER_ID;
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = [
      'position: fixed',
      'left: 0',
      'top: 0',
      `width: ${SCREEN_WIDTH}px`,
      `height: ${VIEWPORT_HEIGHT}px`,
      'overflow: hidden',
      'opacity: 0',
      'pointer-events: none',
      'z-index: -1',
      'contain: strict',
    ].join('; ');
    document.body.appendChild(layer);
  }
  return layer;
};

const fail = (entry: FrameEntry, reason: string) => {
  for (const [id, call] of entry.pending) {
    clearTimeout(call.timer);
    call.reject(new Error(reason));
    entry.pending.delete(id);
  }
};

/** A navigation Willow started: the page on record is leaving, even before it says so. */
const markLeaving = (entry: FrameEntry, url: string) => {
  fail(entry, 'The page changed before it answered.');
  entry.headedTo = url;
  if (entry.state) entry.state = { ...entry.state, loading: true, parsed: false };
};

const onMessage = (event: MessageEvent) => {
  const data = event.data as Record<string, unknown> | null;
  if (!data || data[TAG] !== 1) return;
  for (const entry of frames.values()) {
    if (event.source !== entry.iframe.contentWindow) continue;
    if (typeof data.id === 'string') {
      const call = entry.pending.get(data.id);
      if (!call) return;
      entry.pending.delete(data.id);
      clearTimeout(call.timer);
      if (data.ok) call.resolve(data.result);
      else call.reject(new Error(String(data.error || 'The page did not respond.')));
      return;
    }
    const kind = data.event;
    if (kind === 'navigating') {
      entry.headedTo = typeof data.url === 'string' ? data.url : null;
      return;
    }
    if (kind === 'ready' || kind === 'state') {
      if (kind === 'ready') {
        entry.documentVersion += 1;
        entry.readySinceLoad = true;
        entry.unbridged = false;
        entry.headedTo = null;
        // Anything in flight was addressed to the page that just went away.
        fail(entry, 'The page changed before it answered.');
      }
      const state = data as unknown as BridgeState;
      entry.state = {
        url: String(state.url || ''),
        title: String(state.title || ''),
        favicon: String(state.favicon || ''),
        loading: Boolean(state.loading),
        parsed: Boolean(state.parsed ?? !state.loading),
        width: Number(state.width) || SCREEN_WIDTH,
        height: Number(state.height) || VIEWPORT_HEIGHT,
        canGoBack: Boolean(state.canGoBack),
        canGoForward: Boolean(state.canGoForward),
      };
      entry.lastBridgedUrl = entry.state.url || entry.lastBridgedUrl;
      entry.listeners.forEach((listener) => listener({ event: kind, ...entry.state! }));
    } else if (kind === 'unload') {
      // Until the next document reports, the page being left is not the one on screen.
      if (entry.state) entry.state = { ...entry.state, loading: true, parsed: false };
      entry.listeners.forEach((listener) => listener({ event: 'unload' }));
    }
    return;
  }
};

const listen = () => {
  if (listening) return;
  listening = true;
  window.addEventListener('message', onMessage);
};

/** The task's frame, created parked on `url` the first time it is asked for. */
/**
 * `loadAfterMs` holds back the first page: the frame shares Willow's main thread, so a
 * page loading while the pane grows in drops that motion's frames. Until it has
 * loaded, the frame is transparent and the viewer's own surface shows instead of an
 * empty white page.
 */
export const ensureRemoteFrame = (taskId: string, url?: string, { loadAfterMs = 0 }: { loadAfterMs?: number } = {}): HTMLIFrameElement => {
  listen();
  const existing = frames.get(taskId);
  if (existing) return existing.iframe;
  const iframe = document.createElement('iframe');
  iframe.className = 'spark-remote-browser__frame';
  iframe.title = 'Remote browser';
  // No popups, no top-level navigation and no modal dialogs: the page may only
  // run inside its own box. Same-origin is the page's own proxy origin, which is
  // not Willow's, so it grants the page its cookies and storage and nothing else.
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-downloads');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.setAttribute('allow', '');
  iframe.style.cssText = `width: ${SCREEN_WIDTH}px; height: ${VIEWPORT_HEIGHT}px; border: 0; display: block; background: #ffffff; color-scheme: light;`;
  const entry: FrameEntry = {
    taskId,
    iframe,
    pending: new Map(),
    listeners: new Set(),
    state: null,
    documentVersion: 0,
    readySinceLoad: false,
    unbridged: false,
    headedTo: null,
    lastBridgedUrl: null,
    pendingLoad: null,
  };
  // The bridge posts `ready` from <head>, well before the frame's `load`. A load
  // with no `ready` before it is a document the proxy never served a bridge into.
  iframe.addEventListener('load', () => {
    if (iframe.getAttribute('src')) iframe.style.removeProperty('opacity');
    if (!entry.readySinceLoad && iframe.getAttribute('src')) {
      entry.unbridged = true;
      entry.documentVersion += 1;
      fail(entry, UNBRIDGED_PAGE_ERROR);
      const url = entry.headedTo || entry.state?.url || '';
      entry.state = {
        url,
        title: url ? displayUrl(url) : '',
        favicon: '',
        loading: false,
        parsed: true,
        width: SCREEN_WIDTH,
        height: VIEWPORT_HEIGHT,
        canGoBack: Boolean(entry.lastBridgedUrl && entry.lastBridgedUrl !== url),
        canGoForward: false,
      };
      entry.listeners.forEach((listener) => listener({ event: 'state', ...entry.state! }));
    }
    entry.readySinceLoad = false;
    entry.listeners.forEach((listener) => listener({ event: 'frame-load', unbridged: entry.unbridged }));
  });
  frames.set(taskId, entry);
  if (url) {
    iframe.style.opacity = '0';
    if (loadAfterMs > 0) {
      entry.pendingLoad = setTimeout(() => {
        entry.pendingLoad = null;
        iframe.src = toBrowseUrl(url);
      }, loadAfterMs);
    } else {
      iframe.src = toBrowseUrl(url);
    }
  }
  parkingLayer().appendChild(iframe);
  return iframe;
};

export const hasRemoteFrame = (taskId: string): boolean => frames.has(taskId);

/** Loads `url` (a real page URL) in the task's frame. */
export const navigateRemoteFrame = (taskId: string, url: string) => {
  const iframe = ensureRemoteFrame(taskId);
  const entry = frames.get(taskId)!;
  cancelPendingLoad(entry);
  markLeaving(entry, url);
  iframe.src = toBrowseUrl(url);
};

/** Loads `url` over the current page, so the page being left drops out of the frame's history. */
const replaceFramePage = (entry: FrameEntry, url: string) => {
  cancelPendingLoad(entry);
  markLeaving(entry, url);
  const target = toBrowseUrl(url);
  const view = entry.iframe.contentWindow;
  if (view) {
    try {
      view.location.replace(target);
      return;
    } catch {
      // Fall through to a navigation that keeps the page in history.
    }
  }
  entry.iframe.src = target;
};

/**
 * Back, forward and reload, for the toolbar and the browser agent alike. A page
 * with no bridge cannot be asked to move, so going back replaces it with the last
 * page that had one, and reloading loads its address again.
 */
export const stepRemoteFrame = async (
  taskId: string,
  op: 'back' | 'forward' | 'reload',
): Promise<{ success: boolean; error?: string }> => {
  const entry = frames.get(taskId);
  if (!entry) return { success: false, error: 'The remote browser is not open.' };
  if (!entry.unbridged) return callRemoteFrame<{ success: boolean; error?: string }>(taskId, op);
  if (op === 'forward') return { success: false, error: 'There is no later page to go forward to.' };
  const url = op === 'back' ? entry.lastBridgedUrl : entry.state?.url;
  if (!url) {
    return {
      success: false,
      error: op === 'back' ? 'There is no earlier page to go back to.' : 'This page has no address to reload.',
    };
  }
  replaceFramePage(entry, url);
  return { success: true };
};

/** Shows the frame inside `container`; the returned function parks it again. */
export const adoptRemoteFrame = (taskId: string, container: HTMLElement): (() => void) => {
  const iframe = ensureRemoteFrame(taskId);
  moveInto(container, iframe);
  return () => {
    if (iframe.parentElement === container) moveInto(parkingLayer(), iframe);
  };
};

export const remoteFrameState = (taskId: string): BridgeState | null => frames.get(taskId)?.state ?? null;

export const remoteFrameDocumentVersion = (taskId: string): number => frames.get(taskId)?.documentVersion ?? 0;

/** The frame is showing a document with no bridge, which takes no requests. */
export const isRemoteFrameUnbridged = (taskId: string): boolean => frames.get(taskId)?.unbridged ?? false;

export const lastBridgedRemoteUrl = (taskId: string): string | null => frames.get(taskId)?.lastBridgedUrl ?? null;

export const onRemoteFrameEvent = (taskId: string, listener: (event: BridgeEvent) => void): (() => void) => {
  ensureRemoteFrame(taskId);
  const entry = frames.get(taskId)!;
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
};

/** One request to the page's bridge. Rejects on timeout, or if the page navigates first. */
export const callRemoteFrame = <T = unknown>(
  taskId: string,
  op: string,
  args: Record<string, unknown> = {},
  timeoutMs = 15_000,
): Promise<T> => {
  const entry = frames.get(taskId);
  const target = entry?.iframe.contentWindow;
  if (!entry || !target) return Promise.reject(new Error('The remote browser is not open.'));
  if (entry.unbridged) return Promise.reject(new Error(UNBRIDGED_PAGE_ERROR));
  const id = `rb-${Date.now().toString(36)}-${(sequence += 1).toString(36)}`;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      entry.pending.delete(id);
      reject(new Error('The page did not respond in time.'));
    }, timeoutMs);
    entry.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    target.postMessage({ [TAG]: 1, id, op, args }, '*');
  });
};

export const disposeRemoteFrame = (taskId: string) => {
  const entry = frames.get(taskId);
  if (!entry) return;
  fail(entry, 'The remote browser was closed.');
  entry.listeners.clear();
  entry.iframe.remove();
  frames.delete(taskId);
};
