/**
 * GitHub's token source — a token the user pastes, because GitHub leaves no other way.
 *
 * The third flow behind Connected Apps, and the only one with no consent screen at all.
 * That is not a shortcut taken to save an afternoon; it is the only thing that can be
 * built from a browser, and the reason is worth stating precisely because "add GitHub
 * OAuth" sounds like a solved problem:
 *
 * - `api.github.com` sends `access-control-allow-origin: *`, so every read in
 *   `github.ts` works from a page. The API half is not the problem.
 * - `github.com/login/oauth/access_token` — the step that turns the code from the
 *   consent screen into a token — sends no CORS headers whatsoever, and the page it
 *   sits behind carries `connect-src 'self'`. A browser cannot post to it. This is
 *   deliberate on GitHub's part: the exchange requires a client secret, and a client
 *   secret shipped in a single-page app is not a secret.
 * - The device flow posts to that same endpoint, so it fails the same way. It is the
 *   usual suggestion at this point and it does not work here either.
 *
 * That leaves two honest options: a serverless function holding the client secret, or a
 * personal access token the user creates and pastes. Willow does the second, which needs
 * no deployment and puts no secret anywhere, and it fits `TokenSource` without bending
 * it — `get` returns a credential already held, which is exactly that contract.
 *
 * Where the token lives, and why it is the least durable of the three, is in
 * `session-store.ts`.
 *
 * ## Scopes are nominal here, and the card says so
 *
 * A fine-grained token's permissions are chosen on GitHub's website, not requested by
 * Willow, so nothing in this file can widen or narrow what the token can do. The scope
 * strings in `scopes.ts` are still real and still load-bearing twice over: the
 * authorization machinery treats an empty scope list as "cannot be authorized", and the
 * summaries are what the Settings card tells the user to tick when they create the
 * token. What they are not is a request.
 *
 * So if the user grants more than Willow asks for, Willow can do more than it says.
 * That is the one thing a pasted token gets structurally wrong next to a consent
 * screen, it cannot be fixed from here, and the card states it rather than implying a
 * limit that nothing enforces.
 */

import { refreshAuthorizations } from '../authorization';
import { setTokenSource, type TokenSource } from '../token-source';
import { clearGithubGrant, readGithubToken, storeGithubGrant } from './session-store';

const GITHUB_API = 'https://api.github.com';

export interface GithubIdentity {
  login: string;
  name?: string;
}

/**
 * Check a token against GitHub and find out whose it is.
 *
 * The verification is the point; the login is a bonus. A pasted credential has no
 * consent screen to fail against, so this is the only moment anything can tell the user
 * they pasted the wrong thing — and a switch that flips on and then quietly reads
 * nothing is the exact failure this feature keeps working to avoid. One request, at the
 * moment they click, buys certainty.
 *
 * Deliberately not using `createAuthorizedFetch`: that reads the token from a
 * `TokenSource`, and the token being checked here is not stored yet.
 */
export const verifyGithubToken = async (
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GithubIdentity | null> => {
  const trimmed = token.trim();
  if (!trimmed) return null;

  try {
    const response = await fetchImpl(`${GITHUB_API}/user`, {
      headers: { Authorization: `Bearer ${trimmed}`, Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const json: any = await response.json();
    if (!json || typeof json.login !== 'string') return null;
    return { login: json.login, name: typeof json.name === 'string' ? json.name : undefined };
  } catch {
    return null;
  }
};

/**
 * Verify a pasted token and keep it if it works.
 *
 * Returns the identity so the card can name the account that is connected, which is
 * worth showing: someone with a work account and a personal one has no other way to
 * tell which of the two they just pasted.
 */
export const saveGithubToken = async (
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GithubIdentity | null> => {
  const identity = await verifyGithubToken(token, fetchImpl);
  if (!identity) return null;
  storeGithubGrant(token.trim(), identity.login);
  return identity;
};

/**
 * The `TokenSource` over a pasted token.
 *
 * `get` and `request` are the same function, and that is the honest mapping rather than
 * a corner cut. The two are split in the interface because asking costs a popup and
 * reading must never open one; a pasted token has no popup to open, so there is nothing
 * for `request` to do that `get` does not. The asking happens in Settings, before the
 * switch is allowed on — which is why connecting GitHub succeeds only once a token is
 * already stored.
 */
export const createGithubTokenSource = (): TokenSource => ({
  get: async () => readGithubToken(),

  request: async () => readGithubToken(),

  /**
   * Any invalidation drops the token, unlike the other two providers.
   *
   * There is no cache to clear and nothing to renew. Google's `invalidate` throws away
   * an hour-old access token so the next call can silently mint another; Spotify's keeps
   * the refresh token precisely so it can. A personal access token *is* the credential —
   * a 401 on it means revoked, expired or mistyped, and each of those is permanent until
   * the user pastes a new one. Keeping it would mean retrying a dead token on every read
   * for the rest of the session.
   *
   * This is also why the connector passes `authLossStatuses: [401]` to its fetch. GitHub
   * spends 403 on rate limiting, and on the default a burst of reads would throw away a
   * perfectly good token and tell the user to reconnect it.
   */
  invalidate: () => {
    clearGithubGrant();
  },

  forget: () => {
    clearGithubGrant();
  },
});

/** Set once. Same reason as the Spotify source: a React effect, twice under StrictMode. */
let installed = false;

/**
 * Install the GitHub token source.
 *
 * The one provider with no setup gate: there is no client id to configure, because there
 * is no OAuth client. A build with no `VITE_*` variables at all still offers GitHub, and
 * the only thing between the user and a connection is a token they make themselves.
 *
 * Returns whether a token is actually held, rather than whether the install happened —
 * the latter is unconditionally true and would tell a caller nothing.
 */
export const initGithubTokenSource = (): boolean => {
  if (!installed) {
    setTokenSource(createGithubTokenSource(), 'github');
    installed = true;
    // Finds out whether a token survived into this page, so the tool surface reflects
    // that before the first chat turn rather than whenever Settings is next opened.
    void refreshAuthorizations();
  }
  return Boolean(readGithubToken());
};

export { clearGithubGrant, readGithubLogin, readGithubToken } from './session-store';
