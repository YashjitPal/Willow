/**
 * Web search tool. Provider precedence:
 *   1. Tavily  (if a tavily key is configured)   — purpose-built search API
 *   2. Brave   (if a brave key is configured)    — web search API
 *   3. DuckDuckGo HTML (no key)                  — best-effort scrape fallback
 */

import type { ProviderKeys } from '../domain/types.ts';
import { fetchWithRetry } from '../providers/types.ts';

const MAX_SEARCH_RESPONSE_BYTES = 4 * 1024 * 1024;

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

function normalizeSearchResultUrl(rawUrl: unknown): string | undefined {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return undefined;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username || url.password || !url.hostname) return undefined;
  return url.href;
}

function resultWithSafeUrl(
  rawUrl: unknown,
  title: string,
  snippet: string,
): WebSearchResult | undefined {
  const url = normalizeSearchResultUrl(rawUrl);
  return url ? { title, url, snippet } : undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

async function readBoundedText(res: Response, provider: string): Promise<string> {
  const advertisedLength = Number(res.headers.get('content-length'));
  if (Number.isFinite(advertisedLength) && advertisedLength > MAX_SEARCH_RESPONSE_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error(`${provider} response exceeds ${MAX_SEARCH_RESPONSE_BYTES} bytes`);
  }
  if (!res.body) return '';

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_SEARCH_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`${provider} response exceeds ${MAX_SEARCH_RESPONSE_BYTES} bytes`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function readBoundedJson<T>(res: Response, provider: string): Promise<T> {
  const text = await readBoundedText(res, provider);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${provider} returned invalid JSON`);
  }
}

async function tavilySearch(
  key: string,
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  const res = await fetchWithRetry(
    'https://api.tavily.com/search',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: maxResults }),
      redirect: 'error',
      signal,
      timeoutMs: 20_000,
    },
    'tavily',
    1,
  );
  if (!res.ok) throw new Error(`tavily HTTP ${res.status}`);
  const data = await readBoundedJson<{
    results?: Array<{ title: string; url: string; content: string }>;
  }>(res, 'tavily');
  return (data.results ?? []).flatMap((r) => {
    const result = resultWithSafeUrl(r.url, r.title, r.content?.slice(0, 400) ?? '');
    return result ? [result] : [];
  }).slice(0, maxResults);
}

async function braveSearch(
  key: string,
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  const res = await fetchWithRetry(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
    {
      method: 'GET',
      headers: { accept: 'application/json', 'x-subscription-token': key },
      redirect: 'error',
      signal,
      timeoutMs: 20_000,
    },
    'brave',
    1,
  );
  if (!res.ok) throw new Error(`brave HTTP ${res.status}`);
  const data = await readBoundedJson<{
    web?: { results?: Array<{ title: string; url: string; description?: string }> };
  }>(res, 'brave');
  return (data.web?.results ?? []).flatMap((r) => {
    const result = resultWithSafeUrl(r.url, stripTags(r.title), stripTags(r.description ?? ''));
    return result ? [result] : [];
  }).slice(0, maxResults);
}

async function duckDuckGoSearch(query: string, maxResults: number, signal?: AbortSignal): Promise<WebSearchResult[]> {
  const res = await fetchWithRetry(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    {
      method: 'GET',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        accept: 'text/html',
      },
      redirect: 'error',
      signal,
      timeoutMs: 20_000,
    },
    'duckduckgo',
    1,
  );
  if (!res.ok) throw new Error(`duckduckgo HTTP ${res.status}`);
  const html = await readBoundedText(res, 'duckduckgo');

  const results: WebSearchResult[] = [];
  // result blocks: <a rel="nofollow" class="result__a" href="...">title</a>
  // snippets:      <a class="result__snippet" ...>snippet</a>
  const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([^]*?)<\/a>/g;
  const snippetRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([^]*?)<\/a>/g;
  const links: Array<{ url: string; title: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) && links.length < maxResults * 2) {
    let url = decodeEntities(m[1]);
    // DDG wraps urls: //duckduckgo.com/l/?uddg=<encoded>&rut=...
    const uddg = /[?&]uddg=([^&]+)/.exec(url);
    if (uddg) {
      try {
        url = decodeURIComponent(uddg[1]);
      } catch {
        continue;
      }
    }
    links.push({ url, title: stripTags(m[2]) });
  }
  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) && snippets.length < maxResults * 2) {
    snippets.push(stripTags(m[1]));
  }
  for (let i = 0; i < links.length && results.length < maxResults; i++) {
    const result = resultWithSafeUrl(links[i].url, links[i].title, snippets[i] ?? '');
    if (result) results.push(result);
  }
  return results;
}

export async function webSearch(
  query: string,
  keys: ProviderKeys | undefined,
  maxResults = 5,
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  // Keep provider pagination deterministic even when an untrusted node
  // configuration supplies NaN, Infinity, or a fractional count.
  const requested = Number.isFinite(maxResults) ? Math.floor(maxResults) : 5;
  const capped = Math.max(1, Math.min(requested, 10));
  const tavily = keys?.tavily?.[0] || process.env.TAVILY_API_KEY;
  if (tavily) {
    try {
      return await tavilySearch(tavily, query, capped, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      // fall through to the next provider
    }
  }
  const brave = keys?.brave?.[0] || process.env.BRAVE_API_KEY;
  if (brave) {
    try {
      return await braveSearch(brave, query, capped, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      // fall through to the keyless provider
    }
  }
  return duckDuckGoSearch(query, capped, signal);
}
