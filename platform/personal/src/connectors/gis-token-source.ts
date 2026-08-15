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

import { refreshAuthorizations } from './authorization';
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

/**
 * How long to wait for Google's script before calling connectors unavailable.
 *
 * A tag blocked by an extension can fire neither `load` nor `error`, so the
 * deadline is what stops Connected Apps from waiting on a script that is never
 * arriving.
 */
const SCRIPT_TIMEOUT_MS = 10_000;

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
    include_granted_scopes?: boolean;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type?: string }) => void;
  }) => TokenClient;
}

const oauth2 = (): GoogleOAuth2 | null =>
  (globalThis as any).google?.accounts?.oauth2 ?? null;

/** In flight or finished, shared by every caller. See `loadGisScript`. */
let scriptLoad: Promise<void> | null = null;

/**
 * Load GIS, and wait for it to have actually run.
 *
 * The one shared promise is the whole point. This is called once when Connected
 * Apps mounts and again the moment auth resolves and supplies a login hint —
 * twice more under StrictMode in dev. An earlier version returned as soon as a
 * `gsi/client` tag existed in the DOM, so those later calls came back while the
 * first one's script was still downloading: `google.accounts.oauth2` did not
 * exist yet, `initBrowserTokenSource` read that as unconfigured, and the tab
 * showed the "needs a client id" banner on a build that had one. Existing tag is
 * not the same fact as script has run, and only the second one is worth waiting
 * for.
 */
const loadGisScript = (): Promise<void> => {
  if (oauth2()) return Promise.resolve();
  if (scriptLoad) return scriptLoad;

  scriptLoad = new Promise<void>((resolve) => {
    if (typeof document === 'undefined') {
      resolve();
      return;
    }

    let settled = false;
    // Resolves either way: a blocked script is "no connectors", not a crash, and
    // never a promise left hanging. Clearing the cache when nothing arrived lets
    // a later mount retry, so a slow first paint is not permanent.
    const finish = () => {
      if (settled) return;
      settled = true;
      if (!oauth2()) scriptLoad = null;
      resolve();
    };

    const existing = document.querySelector<HTMLScriptElement>('script[src*="gsi/client"]');
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', finish, { once: true });
    setTimeout(finish, SCRIPT_TIMEOUT_MS);

    if (!existing) {
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return scriptLoad;
};

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
          /*
           * Ask for these scopes and nothing else.
           *
           * GIS defaults this to true, which quietly adds every scope the account
           * has already granted this client to whatever is being requested now.
           * That turns a YouTube request into a YouTube-plus-everything-granted
           * request, and Google refuses to issue YouTube scopes alongside other
           * APIs' — the connect popup dies on `invalid_request` naming two scopes
           * Willow never asked for together. Which pairs conflict is Google's
           * business and undocumented, so the fix is to stop sending scopes this
           * request did not ask for rather than to special-case YouTube.
           *
           * Nothing is lost: prior grants survive on Google's side, and each token
           * is cached against the exact scopes it covers.
           */
          include_granted_scopes: false,
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

  /*
   * Find out what still works, without asking.
   *
   * Tokens die with the tab, so every reload starts with connected products and
   * no access. `refreshAuthorizations` tries a silent renewal of grants the user
   * has already given — a hidden iframe, no popup, no click — and whatever comes
   * back decides which connectors get tools this session.
   *
   * Not awaited. It is a network round trip, and the caller is a React effect
   * deciding whether to render the "not configured" banner; blocking that on a
   * token refresh would leave Connected Apps blank for as long as Google takes.
   * The store it writes to is reactive, so the tools and the cards both follow
   * along when it lands.
   *
   * No argument, deliberately. Passing `installed` would override every provider's
   * source, so Spotify's scopes would be asked of Google — which has never heard of
   * `user-top-read` — and a live Spotify grant would be marked expired at boot.
   */
  void refreshAuthorizations();
  return true;
};

let lastHint: string | undefined;

const readClientId = (): string | undefined => {
  try {
    /*
     * `import.meta.env`, spelled exactly like that.
     *
     * A browser defines no such property. In dev, Vite supplies it by scanning
     * each module's source for that literal text and, when it finds it, adding
     * `import.meta.env = {...}` to the top of what it serves. The check is on the
     * text, so `import.meta?.env` never matches: nothing is added, the property
     * stays undefined, every client id looks absent, and the Settings tab claims
     * connectors are not set up. The optional chain that reads as defensive is
     * what breaks it.
     *
     * The chain after `.env` is fine, and is the part that carries a non-Vite
     * caller (a test importing this module directly): there the whole expression
     * is undefined rather than an object.
     */
    const env = (import.meta.env as any) ?? undefined;
    const value = env?.[CLIENT_ID_ENV];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
};

/** Whether an OAuth client id is configured at all. Drives the UI's empty state. */
export const connectorsConfigured = (): boolean => Boolean(readClientId());
