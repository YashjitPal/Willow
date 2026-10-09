import { AGENTS_LOCAL_PORT, AGENTS_ORIGIN, WILLOW_LOCAL_PORT, WILLOW_ORIGIN } from './connection';

/** The only origins the bridge is installed in, and the only ones it listens to. */
export const PAGE_ORIGINS = [AGENTS_ORIGIN, WILLOW_ORIGIN];

export type PageMessage =
  | { kind: 'phone-call'; id: string; tool: string; args: unknown }
  | { kind: 'pairing-required' }
  | { kind: 'open-settings' }
  | { kind: 'open-external'; url: string }
  /** Willow's own notification (platform/core desktop-bridge.ts `showNotification`). */
  | { kind: 'notify'; title: string; body?: string; tag?: string };

export type NativeMessage =
  | { kind: 'phone-result'; id: string; ok: true; result: unknown }
  | { kind: 'phone-result'; id: string; ok: false; error: string }
  | { kind: 'tools-changed'; tools: string[] };

/**
 * `window.__WILLOW_ANDROID__`, the page's side of the bridge. ES5, idempotent: run
 * again on the same document it keeps the page's listeners and updates the rest.
 */
export function bridgeScript(tools: readonly string[]): string {
  return `(function () {
  var bridge = window.__WILLOW_ANDROID__;
  if (!bridge || typeof bridge !== 'object') {
    bridge = { listeners: [] };
    window.__WILLOW_ANDROID__ = bridge;
  }
  if (Object.prototype.toString.call(bridge.listeners) !== '[object Array]') {
    bridge.listeners = [];
  }
  bridge.version = 1;
  bridge.agentsOrigin = ${JSON.stringify(AGENTS_ORIGIN)};
  bridge.tools = ${JSON.stringify(tools)};
  bridge.receive = function (message) {
    var listeners = bridge.listeners.slice();
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](message);
      } catch (error) {
        rethrow(error);
      }
    }
  };
  bridge.post = function (message) {
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  };
  bridge.openSettings = function () {
    bridge.post({ kind: 'open-settings' });
  };
  function rethrow(error) {
    setTimeout(function () {
      throw error;
    }, 0);
  }
})();
true;`;
}

/** For `injectJavaScript`: hands one message to the page's listeners. */
export function deliverScript(message: NativeMessage): string {
  return `window.__WILLOW_ANDROID__ && window.__WILLOW_ANDROID__.receive(${JSON.stringify(message)}); true;`;
}

/** For `injectJavaScript`: the agent-access switch changed while the page is open. */
export function toolsChangedScript(tools: readonly string[]): string {
  const list = JSON.stringify(tools);
  return `(function () {
  var bridge = window.__WILLOW_ANDROID__;
  if (!bridge) return;
  bridge.tools = ${list};
  bridge.receive({ kind: 'tools-changed', tools: ${list} });
})();
true;`;
}

/**
 * `nativeEvent.url` of a message is the origin of the frame that sent it (the page's
 * URL on WebViews too old for WebMessageListener). Frames from anywhere else - an
 * embedded site, Spark's browsed pages on *.localhost - are ignored.
 */
export function isPageOrigin(url: string | undefined): boolean {
  const match = /^http:\/\/localhost:(\d+)(?:[/?#]|$)/i.exec(url ?? '');
  if (!match) return false;
  const port = Number(match[1]);
  return port === AGENTS_LOCAL_PORT || port === WILLOW_LOCAL_PORT;
}

export function parsePageMessage(data: string): PageMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  switch (message.kind) {
    case 'phone-call':
      if (typeof message.id !== 'string' || !message.id) return null;
      return {
        kind: 'phone-call',
        id: message.id,
        tool: typeof message.tool === 'string' ? message.tool : '',
        args: message.args,
      };
    case 'pairing-required':
      return { kind: 'pairing-required' };
    case 'open-settings':
      return { kind: 'open-settings' };
    case 'open-external':
      return typeof message.url === 'string' ? { kind: 'open-external', url: message.url } : null;
    case 'notify': {
      if (typeof message.title !== 'string' || !message.title.trim()) return null;
      const body = typeof message.body === 'string' && message.body ? message.body.slice(0, 4000) : undefined;
      const tag = typeof message.tag === 'string' && /^[\w.:-]{1,100}$/.test(message.tag) ? message.tag : undefined;
      return {
        kind: 'notify',
        title: message.title.slice(0, 200),
        ...(body ? { body } : {}),
        ...(tag ? { tag } : {}),
      };
    }
    default:
      return null;
  }
}
