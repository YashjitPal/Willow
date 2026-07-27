/**
 * Optional bridge for a browser extension / desktop shell.
 *
 * A normal web page cannot call chrome.tabs.*.  The Spark browser surface
 * therefore owns a local tab model and uses this small message protocol when
 * an installed companion bridge is present.  Without a bridge, callers get a
 * null response and continue to use the embedded session safely.
 */

export interface BrowserTabSnapshot {
  id: string;
  title: string;
  url: string;
  active?: boolean;
  windowId?: number;
  faviconUrl?: string;
}

export interface BrowserTabsBridgeMessage {
  source: 'willow-browser-bridge';
  type: 'BROWSER_TABS_RESPONSE' | 'BROWSER_TAB_ACTIVATED' | 'BROWSER_TAB_UPDATED';
  tabs?: BrowserTabSnapshot[];
  tab?: BrowserTabSnapshot;
}

interface ChromeRuntimeLike {
  sendMessage?: (
    message: unknown,
    callback?: (response: unknown) => void,
  ) => void;
  lastError?: { message?: string };
}

interface ChromeLike {
  runtime?: ChromeRuntimeLike;
}

const getChromeRuntime = (): ChromeRuntimeLike | null => {
  if (typeof window === 'undefined') return null;
  const chromeLike = (window as Window & { chrome?: ChromeLike }).chrome;
  return chromeLike?.runtime ?? null;
};

const isTabSnapshot = (value: unknown): value is BrowserTabSnapshot => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BrowserTabSnapshot>;
  return typeof candidate.id === 'string'
    && typeof candidate.title === 'string'
    && typeof candidate.url === 'string';
};

const parseBridgeMessage = (value: unknown): BrowserTabsBridgeMessage | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<BrowserTabsBridgeMessage>;
  if (candidate.source !== 'willow-browser-bridge') return null;
  if (!['BROWSER_TABS_RESPONSE', 'BROWSER_TAB_ACTIVATED', 'BROWSER_TAB_UPDATED'].includes(String(candidate.type))) {
    return null;
  }
  const tabs = Array.isArray(candidate.tabs)
    ? candidate.tabs.filter(isTabSnapshot)
    : undefined;
  return {
    source: 'willow-browser-bridge',
    type: candidate.type as BrowserTabsBridgeMessage['type'],
    tabs,
    tab: isTabSnapshot(candidate.tab) ? candidate.tab : undefined,
  };
};

/** True when an extension/desktop shell has exposed a runtime messaging API. */
export const hasBrowserTabsBridge = (): boolean => Boolean(getChromeRuntime()?.sendMessage);

/**
 * Ask an optional companion bridge for tabs in the user's current browser
 * window.  The short timeout keeps the Spark UI responsive when no bridge is
 * installed (the normal case for a hosted web app).
 */
export const requestBrowserTabs = async (timeoutMs = 450): Promise<BrowserTabSnapshot[] | null> => {
  if (typeof window === 'undefined') return null;
  const runtime = getChromeRuntime();

  if (runtime?.sendMessage) {
    const response = await new Promise<unknown>((resolve) => {
      let settled = false;
      const finish = (value: unknown) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const timer = window.setTimeout(() => finish(null), timeoutMs);
      try {
        runtime.sendMessage?.({ source: 'willow-spark', type: 'REQUEST_BROWSER_TABS' }, (value) => {
          window.clearTimeout(timer);
          // Chrome exposes a transient `lastError` when the companion is
          // unavailable or has no content-script on this page. Reading it
          // prevents an otherwise noisy console warning and treats that case
          // the same as a timed-out bridge.
          finish(runtime.lastError ? null : value);
        });
      } catch {
        window.clearTimeout(timer);
        finish(null);
      }
    });
    if (Array.isArray(response)) return response.filter(isTabSnapshot);
    if (response && typeof response === 'object' && Array.isArray((response as { tabs?: unknown }).tabs)) {
      return (response as { tabs: unknown[] }).tabs.filter(isTabSnapshot);
    }
  }

  // Fallback protocol for a desktop shell/content-script bridge. Install the
  // listener before posting so a synchronous desktop-shell response cannot be
  // lost between the postMessage call and the Promise executor.
  return new Promise<BrowserTabSnapshot[] | null>((resolve) => {
    let settled = false;
    const finish = (value: BrowserTabSnapshot[] | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
      resolve(value);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const message = parseBridgeMessage(event.data);
      if (message?.type === 'BROWSER_TABS_RESPONSE') finish(message.tabs ?? []);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'willow-spark', type: 'REQUEST_BROWSER_TABS' }, '*');
  });
};

/** Subscribe to active-tab/title changes sent by an optional bridge. */
export const subscribeToBrowserTabEvents = (
  listener: (message: BrowserTabsBridgeMessage) => void,
): (() => void) => {
  if (typeof window === 'undefined') return () => undefined;
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window) return;
    const message = parseBridgeMessage(event.data);
    if (message) listener(message);
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
};

/** Ask a companion bridge to activate a real browser tab, when available. */
export const activateBrowserTab = (tabId: string): boolean => {
  const runtime = getChromeRuntime();
  if (runtime?.sendMessage) {
    try {
      runtime.sendMessage({ source: 'willow-spark', type: 'ACTIVATE_BROWSER_TAB', tabId });
      return true;
    } catch {
      return false;
    }
  }
  if (typeof window !== 'undefined') {
    window.postMessage({ source: 'willow-spark', type: 'ACTIVATE_BROWSER_TAB', tabId }, '*');
    return true;
  }
  return false;
};
