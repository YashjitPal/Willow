/**
 * The browser token source: Google Identity Services.
 *
 * GIS is how a browser-only app gets an OAuth access token for Google APIs. The
 * token comes from a popup where the user picks the Google account already
 * signed into Willow and clicks Allow once. Google issues no refresh token to a
 * browser client — there is nowhere to keep a client secret — so the access
 * token lives about an hour and the connector then goes quiet until the user
 * reconnects. That was the accepted trade. A later server-side deployment
 * replaces this one file with one that holds a refresh token, and no connector
 * notices.
 *
 * The client id comes from the environment because there is no OAuth client in
 * the repo to point at: the Firebase config is for sign-in, and sign-in scopes
 * are not API scopes. With no id configured, nothing is installed and the whole
 * package stays on `NO_TOKENS`, so Connected Apps shows a "not configured"
 * state rather than throwing on boot.
 */

import { createTokenCache, setTokenSource, type CachedToken, type TokenSource } from './token-source';

/** Set in the deployed app; normally unset in dev. */
const CLIENT_ID_ENV = 'VITE_GOOGLE_OAUTH_CLIENT_ID';

/** Google's default is an hour; used when a response omits `expires_in`. */
const DEFAULT_EXPIRY_SECONDS = 3600;

/**
 * How long to wait for a silent token before giving up.
 *
 * `prompt: 'none'` runs in a hidden iframe and, when the grant is gone, can fail
 * by simply never calling back. Without a deadline a background build would hang
 * on it forever, which looks exactly like a build that is still running.
 */
const SILENT_TIMEOUT_MS = 8_000;

interface TokenResponse {
  access_token?: string;
  error?: string;
  expires_in?: number;
}

interface TokenClient {
  requestAccessToken: (options?: { prompt?: string; hint?: string }) => void;
}

interface GoogleOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    hint?: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type?: string }) => void;
  }) => TokenClient;
}

const oauth2 = (): GoogleOAuth2 | null =>
  (globalThis as any).google?.accounts?.oauth2 ?? null;

const loadGisScript = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve();
      return;
    }
    if (oauth2() || document.querySelector('script[src*="gsi/client"]')) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    // Resolves either way: a blocked script is "no connectors", not a crash.
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });

export interface GisOptions {
  clientId?: string;
  /**
   * The signed-in account's email.
   *
   * Passed to GIS as `hint`, which is what produces the Allow-only screen: the
   * user is already signed into Willow with this account, so naming it here
   * removes the account chooser and leaves one consent click. Without it Google
   * asks them to pick an account they have already picked.
   */
  loginHint?: string;
}

/**
 * Build a GIS-backed token source. Exported for tests; the app calls
 * `initBrowserTokenSource` instead.
 */
export const createGisTokenSource = ({ clientId, loginHint }: Required<Pick<GisOptions, 'clientId'>> & GisOptions): TokenSource => {
  const cache = createTokenCache();

  const entryFor = (response: TokenResponse, scopes: string[]): CachedToken => ({
    token: response.access_token!,
    scopes,
    expiresAt: Date.now() + (response.expires_in ?? DEFAULT_EXPIRY_SECONDS) * 1000,
  });

  /**
   * One token request. `prompt` is the whole difference between the two methods:
   * `'none'` never shows anything, `''` lets Google decide and therefore may.
   */
  const requestToken = (
    scopes: string[],
    prompt: 'none' | '',
    timeoutMs?: number,
  ): Promise<string | null> => {
    const api = oauth2();
    if (!api) return Promise.resolve(null);

    return new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (token: string | null) => {
        if (settled) return;
        settled = true;
        resolve(token);
      };

      const timer = timeoutMs ? setTimeout(() => finish(null), timeoutMs) : undefined;

      try {
        const client = api.initTokenClient({
          client_id: clientId,
          scope: scopes.join(' '),
          ...(loginHint ? { hint: loginHint } : {}),
          callback: (response) => {
            if (timer) clearTimeout(timer);
            if (!response.access_token) {
              finish(null);
              return;
            }
            cache.put(entryFor(response, scopes));
            finish(response.access_token);
          },
          // Fires when the popup is closed or blocked, which the callback does
          // not cover. Without it, a user closing the window leaves a promise
          // that never settles and a button stuck on "Connecting…".
          error_callback: () => {
            if (timer) clearTimeout(timer);
            finish(null);
          },
        });
        client.requestAccessToken({ prompt, ...(loginHint ? { hint: loginHint } : {}) });
      } catch {
        if (timer) clearTimeout(timer);
        finish(null);
      }
    });
  };

  return {
    /**
     * A token for these scopes if one can be had without asking.
     *
     * Cache first, then a silent refresh of an existing grant. Never prompts:
     * background builds call this, and a consent popup appearing while someone
     * is typing is worse than a build that did not run.
     */
    get: async (scopes) => {
      if (scopes.length === 0) return null;
      const cached = cache.find(scopes);
      if (cached) return cached.token;
      return requestToken(scopes, 'none', SILENT_TIMEOUT_MS);
    },

    /**
     * Ask the user to authorize these scopes. Only ever called from a click.
     *
     * `prompt: ''` is not `'consent'` — it lets Google skip the screen when this
     * account has already granted these scopes, which is what makes reconnecting
     * an expired connector a single click rather than a repeat of the whole
     * consent flow.
     */
    request: async (scopes) => {
      if (scopes.length === 0) return null;
      const cached = cache.find(scopes);
      if (cached) return cached.token;
      return requestToken(scopes, '');
    },

    invalidate: (scopes) => cache.drop(scopes),
  };
};

let installed: TokenSource | null = null;

/** The installed source, or null when connectors are not configured. */
export const browserTokenSource = (): TokenSource | null => installed;

/**
 * Load GIS and install the token source. Safe to call more than once.
 *
 * Returns whether connectors are usable, so the caller can render the
 * "not configured" state without inspecting the environment itself.
 */
export const initBrowserTokenSource = async (options: GisOptions = {}): Promise<boolean> => {
  const clientId = options.clientId ?? readClientId();
  if (!clientId) return false;

  // Re-installing on a login hint change matters: the hint is baked into the
  // source, and a stale one sends the previous user's email to the consent
  // screen after an account switch.
  if (installed && options.loginHint === lastHint) return true;

  await loadGisScript();
  if (!oauth2()) return false;

  lastHint = options.loginHint;
  installed = createGisTokenSource({ clientId, loginHint: options.loginHint });
  setTokenSource(installed);
  return true;
};

let lastHint: string | undefined;

const readClientId = (): string | undefined => {
  try {
    const env = (import.meta as any)?.env;
    const value = env?.[CLIENT_ID_ENV];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
};

/** Whether an OAuth client id is configured at all. Drives the UI's empty state. */
export const connectorsConfigured = (): boolean => Boolean(readClientId());
