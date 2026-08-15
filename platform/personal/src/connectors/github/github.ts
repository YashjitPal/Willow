/**
 * GitHub — pull requests, issues and what the user is actually working on.
 *
 * The connector that exists because "what am I waiting on" is a question with a real
 * answer, and the answer is spread across notifications nobody reads. Three reads, one
 * signal reader, no writes.
 *
 * ## Search, not per-repository listing
 *
 * The obvious shape — list the repositories, then list each one's pull requests — is
 * wrong twice: it is one request per repository against a rate limit counted per token,
 * and it misses everything in a repository the user does not own, which for anyone
 * working with other people is most of what they care about. GitHub's search API answers
 * all of it in a single request, so that is what these use.
 *
 * The interesting part is the qualifier. `involves:` is GitHub's own union of authored,
 * assigned, mentioned and review-requested, which makes it the right default — but
 * `review-requested:` is the one that answers the question people actually have, because
 * a pull request waiting on your review is blocking somebody else. Both are offered, and
 * the tool description says which is which.
 *
 * ## No writes
 *
 * Deliberate, and not for lack of endpoints. Creating a pull request or commenting on an
 * issue is a public act in someone else's repository, and a model doing that from a
 * loosely-worded request is a different order of mistake from a wrongly-created calendar
 * event: the user cannot quietly delete it, other people are already notified, and it is
 * attached to their name. It also means the token only ever needs read permission, which
 * is what makes a pasted credential a defensible thing to ask for at all.
 *
 * ## What the profile takes, and what it will not
 *
 * Languages, and nothing else. `readGithubSignals` counts the primary language across
 * the repositories the token can see and keeps the ones that clear a threshold, so the
 * profile learns "writes TypeScript" and never learns a repository name.
 *
 * That line is drawn on purpose. A fine-grained token usually sees private repositories,
 * and their names are frequently the most sensitive string in the whole account — an
 * unannounced product, a client, an acquisition. A profile bullet is a standing claim
 * about the user that gets sent to a model on later turns, and a private repository name
 * has no business becoming one. Languages are aggregate, stable, and exactly the kind of
 * fact this feature is for.
 */

import { query } from '../authorized-fetch';
import type { ConnectorFetch, ConnectorReader, ConnectorSignal } from '../types';
import { readGithubLogin } from './session-store';

const GITHUB_API = 'https://api.github.com';

/** Repositories read for signals. Sorted by last push, so this is "lately", not "ever". */
const REPO_LIMIT = 30;

/** A language needs this many repositories before it becomes a claim about the user. */
const LANGUAGE_THRESHOLD = 3;

/** Search results per read. GitHub's search caps a page at 100; this is a reading limit. */
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;

/** How the tool's `filter` argument maps onto GitHub's search qualifiers. */
const PR_FILTERS = {
  involves: 'involves',
  author: 'author',
  assigned: 'assignee',
  'review-requested': 'review-requested',
} as const;

export type PullRequestFilter = keyof typeof PR_FILTERS;

export const isPullRequestFilter = (value: string | undefined): value is PullRequestFilter =>
  Boolean(value) && Object.prototype.hasOwnProperty.call(PR_FILTERS, value as string);

const clampLimit = (limit: number | undefined, fallback: number): number => {
  if (!limit || !Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.floor(limit)));
};

export interface GithubItem {
  number: number;
  title: string;
  url: string;
  /** `owner/name`, pulled out of the API's `repository_url`. */
  repo: string;
  author: string;
  updated: string;
  draft: boolean;
  /** Only present on issues and pull requests that have one. */
  comments: number;
}

interface SearchResponse {
  items?: any[];
}

/**
 * `https://api.github.com/repos/octocat/hello-world` → `octocat/hello-world`.
 *
 * The search API returns the repository as an API URL and nothing friendlier, and
 * `octocat/hello-world` is how a person refers to it.
 */
const repoFromUrl = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const match = value.match(/\/repos\/([^/]+\/[^/]+)/);
  return match ? match[1] : '';
};

const asItem = (raw: any): GithubItem | null => {
  if (!raw || typeof raw.title !== 'string' || typeof raw.number !== 'number') return null;
  return {
    number: raw.number,
    title: raw.title,
    url: typeof raw.html_url === 'string' ? raw.html_url : '',
    repo: repoFromUrl(raw.repository_url),
    author: typeof raw.user?.login === 'string' ? raw.user.login : '',
    updated: typeof raw.updated_at === 'string' ? raw.updated_at : '',
    draft: raw.draft === true,
    comments: typeof raw.comments === 'number' ? raw.comments : 0,
  };
};

/**
 * Run one search and shape the results.
 *
 * Returns `null` on failure and `[]` on "nothing matched", which callers must keep
 * apart: an empty list is an answer, and a null is a connection that needs attention.
 * Collapsing the two is how a model ends up telling someone they have no open pull
 * requests because their token expired.
 */
const search = async (
  fetchJson: ConnectorFetch,
  q: string,
  limit: number,
  signal?: AbortSignal,
): Promise<GithubItem[] | null> => {
  const url = `${GITHUB_API}/search/issues${query({
    q,
    sort: 'updated',
    order: 'desc',
    per_page: limit,
  })}`;
  const response = await fetchJson<SearchResponse>(url, { signal });
  if (!response || !Array.isArray(response.items)) return null;
  return response.items.map(asItem).filter((item): item is GithubItem => item !== null);
};

/**
 * Open pull requests matching one of the filters, most recently updated first.
 *
 * `login` is passed rather than read here so this stays a function of its arguments,
 * which is what lets a test drive it without installing session storage.
 */
export const listPullRequests = async (
  fetchJson: ConnectorFetch,
  options: { login: string; filter?: PullRequestFilter; limit?: number; signal?: AbortSignal } ,
): Promise<GithubItem[] | null> => {
  const qualifier = PR_FILTERS[options.filter ?? 'involves'];
  return search(
    fetchJson,
    `is:pr is:open ${qualifier}:${options.login}`,
    clampLimit(options.limit, DEFAULT_SEARCH_LIMIT),
    options.signal,
  );
};

/** Open issues assigned to the user, most recently updated first. */
export const listAssignedIssues = async (
  fetchJson: ConnectorFetch,
  options: { login: string; limit?: number; signal?: AbortSignal },
): Promise<GithubItem[] | null> =>
  search(
    fetchJson,
    `is:issue is:open assignee:${options.login}`,
    clampLimit(options.limit, DEFAULT_SEARCH_LIMIT),
    options.signal,
  );

export interface GithubRepo {
  name: string;
  description: string;
  language: string;
  private: boolean;
  pushed: string;
}

/**
 * The repositories the token can see, most recently pushed first.
 *
 * `affiliation` includes organization membership, because for most people the
 * repositories that matter are not the ones they own.
 */
export const listActiveRepos = async (
  fetchJson: ConnectorFetch,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<GithubRepo[] | null> => {
  const url = `${GITHUB_API}/user/repos${query({
    sort: 'pushed',
    direction: 'desc',
    per_page: clampLimit(options.limit, REPO_LIMIT),
    affiliation: 'owner,collaborator,organization_member',
  })}`;
  const response = await fetchJson<any[]>(url, { signal: options.signal });
  if (!Array.isArray(response)) return null;

  return response
    .filter((raw) => raw && typeof raw.full_name === 'string')
    .map((raw) => ({
      name: raw.full_name as string,
      description: typeof raw.description === 'string' ? raw.description : '',
      language: typeof raw.language === 'string' ? raw.language : '',
      private: raw.private === true,
      pushed: typeof raw.pushed_at === 'string' ? raw.pushed_at : '',
    }));
};

/** Count values, one bucket per key. */
const countBy = <T,>(items: T[], keyOf: (item: T) => string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

/** The busiest keys, above a floor, highest first. */
const topEntries = (
  counts: Map<string, number>,
  take: number,
  threshold: number,
): [string, number][] =>
  [...counts.entries()]
    .filter(([, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, take);

/**
 * Languages, and deliberately nothing else. See the file header on repository names.
 *
 * The threshold is what separates a language someone works in from a language they once
 * touched. Everybody has a stray repository in something they tried for an evening, and
 * a profile bullet claiming they write it is both wrong and hard for the user to trace
 * back to its cause.
 */
export const readGithubSignals = async (
  fetchJson: ConnectorFetch,
  signal?: AbortSignal,
): Promise<ConnectorSignal[]> => {
  const repos = await listActiveRepos(fetchJson, { limit: REPO_LIMIT, signal });
  if (!repos || repos.length === 0) return [];

  const languages = countBy(repos, (repo) => repo.language);
  return topEntries(languages, 4, LANGUAGE_THRESHOLD).map(([language, count]) => ({
    section: 'interests' as const,
    text: `Writes ${language}`,
    source: 'GitHub',
    evidence: `${count} of the user's ${repos.length} most recently active GitHub repositories are primarily ${language}.`,
  }));
};

export const githubConnector: ConnectorReader = {
  id: 'github',
  readSignals: readGithubSignals,
};

export { readGithubLogin };
