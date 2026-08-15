/**
 * The authorized fetch every connector uses.
 *
 * One place that knows about bearer headers, 401 retries and the shape of an API
 * error. Connectors get a function that takes a URL and returns parsed JSON or
 * null, which is what makes each connector file readable as a list of endpoints
 * instead of a pile of error handling.
 *
 * Nothing in here is Google-specific, which is why Spotify uses it unchanged: a
 * bearer token in a header and a 401 meaning "that token is finished" is the whole
 * of OAuth 2 as a client experiences it. It was called `google-fetch` while Google
 * was the only provider, and a Spotify connector importing that would have been the
 * first line of a slow drift back towards one hardcoded provider.
 *
 * Everything fails soft. A connector that returns nothing contributed nothing to
 * this build; a connector that threw would take the whole build with it, and the
 * user would see a profile that stopped updating with no explanation because
 * their Gmail token expired.
 */

import type { ConnectorFetch } from './types';
import type { TokenSource } from './token-source';

/** These APIs are consistently fast or consistently down; 15s covers both. */
const REQUEST_TIMEOUT_MS = 15_000;

export interface AuthorizedFetchOptions {
  tokens: TokenSource;
  scopes: string[];
  /** Fired when a request fails because access was revoked or expired, so the
   *  UI can mark the connector disconnected rather than silently going quiet. */
  onAuthLost?: () => void;
  /**
   * Which statuses mean "this credential is finished". Defaults to 401 and 403.
   *
   * The default is Google's and Spotify's convention: both answer a request whose
   * token lacks the necessary scope with a 403, so treating it as auth loss is what
   * makes a half-granted consent screen visible instead of silent.
   *
   * GitHub spends 403 on something else entirely — it is the rate limit, both the
   * primary hourly one and the secondary abuse limit. Left on the default, a burst of
   * reads would come back 403, the connector would be marked expired, and the user
   * would be told to reconnect a token that was never the problem and would work
   * again in a minute. So GitHub passes `[401]` and takes a rate limit as the
   * transient failure it is.
   */
  authLossStatuses?: number[];
}

/**
 * Build a fetch bound to one connector's scopes.
 *
 * A 401 gets exactly one retry, and only after invalidating the cached token —
 * the common cause is a token that expired between being cached and being used.
 * If the second attempt also 401s the grant is gone, and retrying further would
 * be a loop against Google's rate limiter.
 */
export const createAuthorizedFetch = ({
  tokens,
  scopes,
  onAuthLost,
  authLossStatuses = [401, 403],
}: AuthorizedFetchOptions): ConnectorFetch => {
  const run = async <T,>(url: string, init: RequestInit | undefined, retrying: boolean): Promise<T | null> => {
    const token = await tokens.get(scopes);
    if (!token) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const external = init?.signal;
    const onAbort = () => controller.abort();
    external?.addEventListener('abort', onAbort, { once: true });
    if (external?.aborted) controller.abort();

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init?.headers ?? {}),
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (authLossStatuses.includes(response.status)) {
        tokens.invalidate(scopes);
        if (!retrying && response.status === 401) return await run<T>(url, init, true);
        onAuthLost?.();
        return null;
      }
      if (!response.ok) return null;
      // A 204 has no body; calling .json() on it throws.
      if (response.status === 204) return null as T;
      return (await response.json()) as T;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    }
  };

  return <T,>(url: string, init?: RequestInit) => run<T>(url, init, false);
};

/** `?a=1&b=2`, skipping anything unset. */
export const query = (params: Record<string, string | number | boolean | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
};

/**
 * Follow `nextPageToken` up to a page limit.
 *
 * The limit is not a performance guard, it is a scope guard: a connector reading
 * a whole Gmail account produces a profile built from ten thousand emails and a
 * quota bill, when the recent few hundred say everything about the person that
 * this feature is entitled to know.
 */
export const paginate = async <T,>(
  fetchPage: (pageToken?: string) => Promise<{ items: T[]; nextPageToken?: string } | null>,
  maxPages: number,
): Promise<T[]> => {
  const all: T[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(pageToken);
    if (!result) break;
    all.push(...result.items);
    if (!result.nextPageToken) break;
    pageToken = result.nextPageToken;
  }
  return all;
};
