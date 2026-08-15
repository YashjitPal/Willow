/**
 * Authorization code with PKCE, in a browser, with no client secret.
 *
 * The Google side of Willow uses Google Identity Services, which hides all of this
 * behind a library and returns an access token. Spotify publishes no such library,
 * so this is the flow written out: a random verifier, its SHA-256 challenge sent to
 * the authorize endpoint, a popup, a code back, and the verifier exchanged for a
 * token. No secret at any point — the verifier *is* the proof, which is the whole
 * point of PKCE and the reason a public client can do this safely.
 *
 * One genuine advantage over the Google half, and it is the reason the same expiry
 * problem does not recur here: Spotify returns a refresh token. Google refuses to
 * give one to a browser client, so a Google connection has to be renewed silently on
 * every load and lapses whenever that fails. A Spotify refresh token is a durable
 * grant, so `get()` can mint a fresh access token from it without a popup, without a
 * Spotify session in this browser, and without the user present.
 *
 * That durability is also why the refresh token is the one credential here that goes
 * to disk. It is a long-lived bearer credential for someone's listening history and
 * playlists, so this deserves stating plainly rather than being left implicit:
 *
 * - The **access token** stays in memory, like Google's, and dies with the tab.
 * - The **refresh token** goes to `localStorage`, because a connection that
 *   evaporates on reload is the bug this whole session was spent removing. It is
 *   scoped to this origin, readable by any script that can already run here, and
 *   dropped on disconnect. That is the trade, and it is the same one every
 *   browser-side OAuth client makes.
 * - The **verifier** is `sessionStorage`, deleted the moment it is redeemed. It is
 *   single-use and worthless afterwards.
 *
 * ### Development mode
 *
 * Spotify's February 2026 terms put two limits on an unreviewed app that no code can
 * work around: the app owner must hold Spotify Premium, and at most 25 users can be
 * added by hand. So this works for the developer and anyone they list, and a public
 * Willow needs an extended-quota application. The failure is at least legible —
 * Spotify returns 403 for a user who is not on the list.
 */

import { refreshAuthorizations } from '../authorization';
import {
  createTokenCache,
  setTokenSource,
  type CachedToken,
  type TokenSource,
} from '../token-source';

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

const CLIENT_ID_ENV = 'VITE_SPOTIFY_CLIENT_ID';

const VERIFIER_KEY = 'willow:spotify-pkce-verifier';
const REFRESH_KEY = 'willow:spotify-refresh-token';

/** How long to wait for the user to finish with the popup before giving up. */
const CONSENT_TIMEOUT_MS = 180_000;

/** Spotify tokens last an hour; the cache treats them as expiring a minute early. */
const DEFAULT_EXPIRY_S = 3600;

/**
 * `import.meta.env`, spelled exactly like that.
 *
 * Vite scans a module's source for that literal text and only then prepends
 * `import.meta.env = {...}` to what it serves. Written `import.meta?.env` the text
 * does not match, nothing is prepended, and every client id reads as absent — which
 * is a bug this repo has already had once, in `gis-token-source.ts`, where it
 * presented as "connectors are not configured" on a build that was configured.
 */
const readClientId = (): string | undefined => {
  try {
    const env = (import.meta.env as any) ?? undefined;
    const value = env?.[CLIENT_ID_ENV];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
};

export const spotifyConfigured = (): boolean => Boolean(readClientId());

/** Where Spotify sends the popup back to. Must match the dashboard exactly. */
export const spotifyRedirectUri = (): string =>
  typeof window === 'undefined' ? '' : `${window.location.origin}/oauth/spotify`;

const randomVerifier = (): string => {
  // 96 bytes of base64url lands inside PKCE's 43–128 character window with room
  // to spare, and `getRandomValues` is the only randomness worth using here.
  const bytes = new Uint8Array(72);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
};

const base64Url = (bytes: Uint8Array | ArrayBuffer): string => {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let raw = '';
  for (const byte of view) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const challengeFor = async (verifier: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(digest);
};

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

const readRefreshToken = (): string | null => {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
};

const writeRefreshToken = (token: string | null): void => {
  try {
    if (token) localStorage.setItem(REFRESH_KEY, token);
    else localStorage.removeItem(REFRESH_KEY);
  } catch {
    // A failed write costs persistence, not correctness: the connection then
    // behaves like the Google ones and lapses on reload.
  }
};

/**
 * Exchange a code, or redeem a refresh token. Returns null on any failure.
 *
 * `application/x-www-form-urlencoded` and no `Authorization` header: a PKCE public
 * client authenticates with `client_id` in the body and the verifier, and sending a
 * basic-auth header without a secret is how this fails with a confusing 400.
 */
const postToken = async (body: Record<string, string>): Promise<TokenResponse | null> => {
  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
    const json = (await response.json()) as TokenResponse;
    if (!response.ok || json.error || !json.access_token) return null;
    return json;
  } catch {
    return null;
  }
};

/**
 * Open the consent popup and wait for the code.
 *
 * The popup posts its code back with `postMessage` and closes itself — see
 * `oauth-callback.ts`, which runs in the popup before the app boots. Polling
 * `popup.location` would be the alternative and it does not work: the popup is on
 * `accounts.spotify.com` for most of its life and reading its location cross-origin
 * throws.
 *
 * Resolves null rather than rejecting on every failure path, including the user
 * simply closing the window. A declined connection is an outcome, not an error.
 */
const requestCode = (authorizeUrl: string, expectedState: string): Promise<string | null> =>
  new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(null);
      return;
    }

    const popup = window.open(authorizeUrl, 'willow-spotify-consent', 'width=520,height=720');
    if (!popup) {
      // Blocked. Almost always means this was not called straight off a click.
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (code: string | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearInterval(closedPoll);
      clearTimeout(timer);
      try {
        popup.close();
      } catch {
        // Already gone.
      }
      resolve(code);
    };

    const onMessage = (event: MessageEvent) => {
      // Origin check first: this listener is on `window`, so anything can post to
      // it, and a code accepted from an unknown origin is a code an attacker chose.
      if (event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; code?: string; state?: string } | null;
      if (!data || data.source !== 'willow-oauth-spotify') return;
      // The state check is what makes this a CSRF defence rather than decoration.
      if (data.state !== expectedState) {
        finish(null);
        return;
      }
      finish(typeof data.code === 'string' ? data.code : null);
    };

    window.addEventListener('message', onMessage);

    // A closed popup fires no event, so this is the only way to notice the user
    // dismissed it. Without it the promise sits unresolved until the timeout and
    // the connect switch spins for three minutes.
    const closedPoll = setInterval(() => {
      if (popup.closed) finish(null);
    }, 500);

    const timer = setTimeout(() => finish(null), CONSENT_TIMEOUT_MS);
  });

export const createSpotifyTokenSource = (
  options: { clientId?: string } = {},
): TokenSource | null => {
  const clientId = options.clientId ?? readClientId();
  if (!clientId) return null;

  const cache = createTokenCache();

  const store = (response: TokenResponse, scopes: string[]): string => {
    const entry: CachedToken = {
      token: response.access_token!,
      // The granted scopes, not the requested ones, when Spotify says. A token
      // cached against scopes it does not actually cover is a 403 later, found by
      // a tool call rather than here.
      scopes: response.scope ? response.scope.split(' ').filter(Boolean) : scopes,
      expiresAt: Date.now() + (response.expires_in ?? DEFAULT_EXPIRY_S) * 1000,
    };
    cache.put(entry);
    if (response.refresh_token) writeRefreshToken(response.refresh_token);
    return entry.token;
  };

  /** Mint an access token from the stored refresh token. Never prompts. */
  const refresh = async (scopes: string[]): Promise<string | null> => {
    const refreshToken = readRefreshToken();
    if (!refreshToken) return null;

    const response = await postToken({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    });

    if (!response) {
      // A rejected refresh token is a revoked grant, not a transient failure.
      // Keeping it would mean retrying a dead credential on every read.
      writeRefreshToken(null);
      return null;
    }
    return store(response, scopes);
  };

  return {
    get: async (scopes) => {
      const cached = cache.find(scopes);
      if (cached) return cached.token;
      return refresh(scopes);
    },

    request: async (scopes) => {
      const cached = cache.find(scopes);
      if (cached) return cached.token;

      // Try the silent path first. Someone reconnecting after a reload has a live
      // refresh token, and a popup they did not need is a popup that reads as the
      // app having forgotten them.
      const refreshed = await refresh(scopes);
      if (refreshed) return refreshed;

      const verifier = randomVerifier();
      const state = randomVerifier().slice(0, 24);
      const challenge = await challengeFor(verifier);
      try {
        sessionStorage.setItem(VERIFIER_KEY, verifier);
      } catch {
        // Without somewhere to keep the verifier the exchange cannot complete, and
        // sending the user through a consent screen that cannot be redeemed is
        // worse than saying no here.
        return null;
      }

      const url = `${AUTHORIZE_URL}?${new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: spotifyRedirectUri(),
        code_challenge_method: 'S256',
        code_challenge: challenge,
        state,
        scope: scopes.join(' '),
      })}`;

      const code = await requestCode(url, state);
      if (!code) return null;

      let storedVerifier: string | null = null;
      try {
        storedVerifier = sessionStorage.getItem(VERIFIER_KEY);
        sessionStorage.removeItem(VERIFIER_KEY);
      } catch {
        storedVerifier = null;
      }
      if (!storedVerifier) return null;

      const response = await postToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: spotifyRedirectUri(),
        client_id: clientId,
        code_verifier: storedVerifier,
      });
      if (!response) return null;
      return store(response, scopes);
    },

    invalidate: (scopes) => {
      cache.drop(scopes);
      // Dropping the refresh token as well only on a full invalidate. A scoped
      // invalidate is the fetch layer reacting to one 401, and the refresh token is
      // very likely still good — throwing it away there would turn a retryable
      // blip into a reconnect.
      if (!scopes) writeRefreshToken(null);
    },

    forget: () => {
      cache.drop();
      writeRefreshToken(null);
    },
  };
};

/** Forget the durable grant. Called on disconnect, so the switch really means off. */
export const clearSpotifyGrant = (): void => writeRefreshToken(null);

let installed: TokenSource | null = null;

/**
 * Install the Spotify token source. Safe to call more than once.
 *
 * Returns whether Spotify is usable at all, on the same terms as
 * `initBrowserTokenSource`, so the caller can render a "not configured" state
 * without reading the environment itself.
 *
 * Synchronous, unlike the Google half — there is no script to load. PKCE is a hash
 * and a popup, both of which the platform already provides, which is the quiet
 * advantage of a flow written out over a flow delegated to a vendor library.
 *
 * The refresh afterwards is what makes a Spotify connection survive a reload
 * properly rather than nearly: the durable grant is on disk, so this mints an access
 * token from it and marks the connector authorized before the first turn, with no
 * popup and no user present.
 */
export const initSpotifyTokenSource = (options: { clientId?: string } = {}): boolean => {
  if (installed) return true;
  const source = createSpotifyTokenSource(options);
  if (!source) return false;
  installed = source;
  setTokenSource(source, 'spotify');
  // Not awaited, for the same reason as the Google side: this is a network round
  // trip and the caller is deciding what to render.
  void refreshAuthorizations();
  return true;
};
