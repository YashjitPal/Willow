/**
 * The authorized fetch every connector uses.
 *
 * One place that knows about bearer headers, 401 retries and Google's error
 * shape. Connectors get a function that takes a URL and returns parsed JSON or
 * null, which is what makes each connector file readable as a list of endpoints
 * instead of a pile of error handling.
 *
 * Everything fails soft. A connector that returns nothing contributed nothing to
 * this build; a connector that threw would take the whole build with it, and the
 * user would see a profile that stopped updating with no explanation because
 * their Gmail token expired.
 */

import type { ConnectorFetch } from './types';
import type { TokenSource } from './token-source';

/** Google's APIs are consistently fast or consistently down; 15s covers both. */
const REQUEST_TIMEOUT_MS = 15_000;

export interface GoogleFetchOptions {
  tokens: TokenSource;
  scopes: string[];
  /** Fired when a request fails because access was revoked or expired, so the
   *  UI can mark the connector disconnected rather than silently going quiet. */
  onAuthLost?: () => void;
}

/**
 * Build a fetch bound to one connector's scopes.
 *
 * A 401 gets exactly one retry, and only after invalidating the cached token —
 * the common cause is a token that expired between being cached and being used.
 * If the second attempt also 401s the grant is gone, and retrying further would
 * be a loop against Google's rate limiter.
 */
export const createGoogleFetch = ({ tokens, scopes, onAuthLost }: GoogleFetchOptions): ConnectorFetch => {
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

      if (response.status === 401 || response.status === 403) {
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
