/**
 * Where the GitHub token and login are kept.
 *
 * A leaf module on purpose — it imports nothing. The token source needs it, and so do
 * the reads in `github.ts`, and those two cannot reach each other: `github.ts` is
 * imported by `registry.ts`, the token source imports `authorization.ts`, and
 * `authorization.ts` imports `registry.ts`. Anything they share has to sit below all
 * three or the import graph closes into a cycle. `connections-store.ts` spells its
 * connector-id list out by hand for the same reason.
 *
 * ## sessionStorage, per tab. Not localStorage.
 *
 * This is the same treatment Willow already gives every credential the user pastes:
 * the provider API keys live in `sessionStorage` too (`platform/auth/use-user-data.ts`),
 * cached per tab against a durable copy in the user's own account. There is no durable
 * copy here, so the token is gone when the tab closes and the user pastes it again next
 * session.
 *
 * That is a real cost and it is the right one. A personal access token is a bearer
 * credential for someone's source code, and GitHub will happily mint one with a
 * one-year life — the opposite of the hour-long access tokens everything else here
 * deals in. Keeping one in `localStorage` would leave a long-lived key to the user's
 * repositories in web storage indefinitely, readable by anything that ever manages to
 * run script on the origin, long after they stopped using the feature. The Spotify
 * refresh token in `localStorage` is a weaker thing by a wide margin: it grants
 * playlists and listening history, and nothing else.
 *
 * So GitHub's lifetime matches Google's rather than Spotify's — connect, use, gone on
 * close — and the machinery for that already exists, because Google's tokens have
 * always died with the tab. A reload finds no token, `refreshAuthorizations` marks the
 * connector expired, the switch goes off, and the Connected Apps banner explains it.
 */

/** The pasted token, per tab. */
const TOKEN_KEY = 'willow:github-token';

/**
 * The account the token belongs to, cached beside it.
 *
 * Every interesting read is a search query naming the user — `involves:octocat` — so
 * without this each one would need a `GET /user` first, doubling the requests against a
 * rate limit that is counted per token rather than per endpoint. Resolved once when the
 * token is verified, which is the moment it has to be fetched anyway.
 */
const LOGIN_KEY = 'willow:github-login';

/**
 * Read from session storage, or `null`.
 *
 * Wrapped because `sessionStorage` is absent in Node and throws outright in a browser
 * with storage disabled. A missing token is a connector that needs reconnecting, which
 * the UI already renders — so a failure here costs persistence and never correctness.
 */
const readSession = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeSession = (key: string, value: string | null): void => {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // Storage disabled. The in-memory mirror below carries this page.
  }
};

/** Mirror, so a build with storage disabled still works for the life of the page. */
let heldToken: string | null = null;
let heldLogin: string | null = null;

export const readGithubToken = (): string | null => heldToken ?? readSession(TOKEN_KEY);

/** The `login` of the account the stored token belongs to. */
export const readGithubLogin = (): string | null => heldLogin ?? readSession(LOGIN_KEY);

export const storeGithubGrant = (token: string | null, login: string | null): void => {
  heldToken = token;
  heldLogin = login;
  writeSession(TOKEN_KEY, token);
  writeSession(LOGIN_KEY, login);
};

/** Drop the token entirely, so a disconnect really is off. */
export const clearGithubGrant = (): void => storeGithubGrant(null, null);
