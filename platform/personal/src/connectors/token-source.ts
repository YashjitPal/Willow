/**
 * Where an access token comes from — behind an interface, on purpose.
 *
 * Today Willow is a browser app, so the token comes from a Google popup and
 * lasts about an hour. Google does not issue refresh tokens to browser clients:
 * there is nowhere to keep a client secret, so the grant that would let an app
 * silently renew access is not available, and no amount of code here changes
 * that. When the token expires the user reconnects. That was the accepted trade.
 *
 * The point of this file is that it is the *only* place that is true. Connectors
 * ask a `TokenSource` for a token; they do not know a popup exists. A later
 * server-side deployment implements the same two methods against a stored refresh
 * token and every connector keeps working untouched.
 *
 * That is also why `get` is allowed to return null and `request` is separate.
 * Reading is something a background build may do silently; asking is something
 * only a user gesture may do, because it opens a popup.
 */

import type { ConnectorId, ConnectorProvider } from './types';

export interface TokenSource {
  /**
   * A token for these scopes if one is already held, else `null`.
   *
   * Must never prompt. A background build calls this, and a popup appearing
   * unbidden while someone is typing is worse than a build that did not run.
   */
  get: (scopes: string[]) => Promise<string | null>;
  /**
   * Ask the user to authorize these scopes, returning a token or `null` if they
   * declined. Only ever called from a click.
   */
  request: (scopes: string[]) => Promise<string | null>;
  /** Forget the cached token, e.g. after a 401. */
  invalidate: (scopes?: string[]) => void;
  /**
   * Drop any durable grant this source holds, so a disconnect really is off.
   *
   * Optional because most sources have nothing to drop: Google's token dies with
   * the tab, so `invalidate` is the whole story there. Spotify's does not — it keeps
   * a refresh token on disk precisely so a reload does not lose the connection, and
   * a disconnect that left that behind would be a switch the user turned off while
   * a working credential sat in their browser.
   */
  forget?: () => void;
}

/**
 * A token source that has nothing.
 *
 * The default, so that every consumer works before connectors are configured and
 * an app with no OAuth client id degrades to "no connectors" rather than to a
 * crash on boot.
 */
export const NO_TOKENS: TokenSource = {
  get: async () => null,
  request: async () => null,
  invalidate: () => {},
};

/**
 * One source per provider.
 *
 * This was a single global, which was right while Google was the only provider and
 * became a bug the moment it wasn't: a Spotify token is not a Google token, and a
 * connector asking the one global source for Spotify scopes would get a Google
 * popup listing scope URLs Google has never heard of.
 *
 * `google` keeps the plain `tokenSource()` / `setTokenSource()` spelling so nothing
 * that predates the second provider has to change, and so tests that install a fake
 * source keep working.
 */
const sources = new Map<ConnectorProvider, TokenSource>();

export const setTokenSource = (
  source: TokenSource | null,
  provider: ConnectorProvider = 'google',
): void => {
  if (source) sources.set(provider, source);
  else sources.delete(provider);
};

export const tokenSource = (provider: ConnectorProvider = 'google'): TokenSource =>
  sources.get(provider) ?? NO_TOKENS;

/**
 * Token cache keyed by scope set.
 *
 * Google returns one token per granted scope set, and asking for a Calendar
 * token when the user has granted Calendar and Gmail should not trigger a second
 * prompt. Storing by sorted scope string means an exact-match hit is free and a
 * superset hit is findable.
 */
export interface CachedToken {
  token: string;
  scopes: string[];
  /** Epoch ms. Treated as expired a minute early, since a token that dies
   *  mid-request costs a retry and a token refreshed a minute early costs
   *  nothing. */
  expiresAt: number;
}

const EXPIRY_MARGIN_MS = 60_000;

export const isFresh = (entry: CachedToken | undefined, now = Date.now()): boolean =>
  !!entry && entry.expiresAt - EXPIRY_MARGIN_MS > now;

/** True when `entry` covers every scope in `wanted`. */
export const covers = (entry: CachedToken, wanted: string[]): boolean =>
  wanted.every((scope) => entry.scopes.includes(scope));

export const scopeKey = (scopes: string[]): string => [...scopes].sort().join(' ');

/**
 * An in-memory store of granted tokens, shared by every connector.
 *
 * Memory rather than localStorage. An OAuth access token is a bearer credential
 * for the user's mail and calendar; persisting it to disk keeps it readable long
 * after the tab is gone, and it would be expired by the time anything read it
 * anyway. Losing it on reload is the correct cost.
 */
export const createTokenCache = () => {
  const entries = new Map<string, CachedToken>();

  return {
    find: (scopes: string[], now = Date.now()): CachedToken | null => {
      const exact = entries.get(scopeKey(scopes));
      if (isFresh(exact, now)) return exact!;
      for (const entry of entries.values()) {
        if (isFresh(entry, now) && covers(entry, scopes)) return entry;
      }
      return null;
    },
    put: (entry: CachedToken): void => {
      entries.set(scopeKey(entry.scopes), entry);
    },
    drop: (scopes?: string[]): void => {
      if (!scopes) {
        entries.clear();
        return;
      }
      entries.delete(scopeKey(scopes));
      for (const [key, entry] of [...entries.entries()]) {
        if (covers(entry, scopes)) entries.delete(key);
      }
    },
  };
};

/**
 * Every scope a set of connectors needs, deduplicated.
 *
 * Used to request one consent covering several products at once. Google shows a
 * single Allow screen listing them, which is both fewer clicks and a more honest
 * disclosure than three separate prompts the user stops reading by the second.
 */
export const scopesFor = (
  connectors: ConnectorId[],
  table: Record<string, { read: { url: string }[]; write: { url: string }[] }>,
  kind: 'read' | 'write' = 'read',
): string[] => {
  const seen = new Set<string>();
  for (const id of connectors) {
    for (const scope of table[id]?.[kind] ?? []) seen.add(scope.url);
  }
  return [...seen];
};
