// Willow TV's routes: Flow TV's (labs.google/flow/tv), under /tv.
export const TV_BASE = '/tv';
export const TV_CHANNELS = `${TV_BASE}/channels`;
export const TV_SHORT_FILMS = `${TV_BASE}/short-films`;
export const TV_FAQ = `${TV_BASE}/faq`;
export const TV_SEARCH = `${TV_BASE}/search`;

/** Search results and short films play in channels of their own, at these slugs. */
export const SEARCH_SLUG = 'search';
export const SHORT_FILMS_SLUG = 'short-films';
export const RESERVED_SLUGS: readonly string[] = [SEARCH_SLUG, SHORT_FILMS_SLUG];

/** Flow TV's query parameters: `random=true` is Mixing, `random-generation=true` a channel tile's shuffle. */
export const PARAM_RANDOM = 'random';
export const PARAM_RANDOM_GENERATION = 'random-generation';
export const PARAM_QUERY = 'q';
export const PARAM_FILTER = 'filter';
export const PARAM_FILM = 'i';

export interface ClipLinkOptions {
  random?: boolean;
  randomGeneration?: boolean;
  query?: string | null;
  filter?: string | null;
}

export const tvGridPath = (slug: string): string => `${TV_BASE}/channel/${encodeURIComponent(slug)}`;

export function tvClipPath(slug: string, id: string, opts?: ClipLinkOptions): string {
  const path = `${tvGridPath(slug)}/${encodeURIComponent(id)}`;
  if (!opts) return path;
  const params = new URLSearchParams();
  if (opts.random) params.set(PARAM_RANDOM, 'true');
  if (opts.randomGeneration) params.set(PARAM_RANDOM_GENERATION, 'true');
  if (opts.query) params.set(PARAM_QUERY, opts.query);
  if (opts.filter) params.set(PARAM_FILTER, opts.filter);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export function tvSearchPath(query: string, filter?: string | null): string {
  const params = new URLSearchParams();
  params.set(PARAM_QUERY, query);
  if (filter && filter !== 'all') params.set(PARAM_FILTER, filter);
  return `${TV_SEARCH}?${params.toString()}`;
}

export const tvShortFilmsPath = (id?: string): string =>
  id ? `${TV_SHORT_FILMS}?${new URLSearchParams({ [PARAM_FILM]: id }).toString()}` : TV_SHORT_FILMS;

/** Flow TV's pages, by the route pattern each is at. */
export type TvRoute =
  | { kind: 'home' }
  | { kind: 'channels' }
  | { kind: 'short-films' }
  | { kind: 'faq' }
  | { kind: 'search' }
  | { kind: 'grid'; slug: string }
  | { kind: 'clip'; slug: string; id: string }
  | { kind: 'not-found' };

export function parseTvPath(pathname: string): TvRoute {
  const rest = pathname.startsWith(TV_BASE) ? pathname.slice(TV_BASE.length) : pathname;
  const parts = rest.split('/').filter(Boolean).map((p) => {
    try { return decodeURIComponent(p); } catch { return p; }
  });
  if (!parts.length) return { kind: 'home' };
  if (parts.length === 1 && parts[0] === 'channels') return { kind: 'channels' };
  if (parts.length === 1 && parts[0] === SHORT_FILMS_SLUG) return { kind: 'short-films' };
  if (parts.length === 1 && parts[0] === 'faq') return { kind: 'faq' };
  if (parts.length === 1 && parts[0] === 'search') return { kind: 'search' };
  if (parts[0] === 'channel' && parts.length === 2) return { kind: 'grid', slug: parts[1] };
  if (parts[0] === 'channel' && parts.length === 3) return { kind: 'clip', slug: parts[1], id: parts[2] };
  return { kind: 'not-found' };
}

/** A channel's pages (its grid and its clips) share one layout, which stays while they change. */
export const isChannelRoute = (r: TvRoute): r is Extract<TvRoute, { kind: 'grid' | 'clip' }> => r.kind === 'grid' || r.kind === 'clip';

/** Opens Willow TV in a tab of its own, as Flow's More menu opens Flow TV, leaving the editor as it was. */
export const openWillowTv = (): void => {
  window.open(TV_BASE, '_blank', 'noopener');
};
