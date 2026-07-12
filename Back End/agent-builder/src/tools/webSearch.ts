/**
 * Web search tool. Provider precedence:
 *   1. Tavily  (if a tavily key is configured)   — purpose-built search API
 *   2. Brave   (if a brave key is configured)    — web search API
 *   3. DuckDuckGo HTML (no key)                  — best-effort scrape fallback
 */

import type { ProviderKeys } from '../domain/types.ts';
import { fetchWithRetry } from '../providers/types.ts';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
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

async function tavilySearch(
  key: string,
  query: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const res = await fetchWithRetry(
    'https://api.tavily.com/search',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: maxResults }),
      timeoutMs: 20_000,
    },
    'tavily',
    1,
  );
  if (!res.ok) throw new Error(`tavily HTTP ${res.status}`);
  const data = (await res.json()) as {
    results?: Array<{ title: string; url: string; content: string }>;
  };
  return (data.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content?.slice(0, 400) ?? '',
  }));
}

async function braveSearch(
  key: string,
  query: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const res = await fetchWithRetry(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
    {
      method: 'GET',
      headers: { accept: 'application/json', 'x-subscription-token': key },
      timeoutMs: 20_000,
    },
    'brave',
    1,
  );
  if (!res.ok) throw new Error(`brave HTTP ${res.status}`);
  const data = (await res.json()) as {
    web?: { results?: Array<{ title: string; url: string; description?: string }> };
  };
  return (data.web?.results ?? []).map((r) => ({
    title: stripTags(r.title),
    url: r.url,
    snippet: stripTags(r.description ?? ''),
  }));
}

async function duckDuckGoSearch(query: string, maxResults: number): Promise<WebSearchResult[]> {
  const res = await fetchWithRetry(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    {
      method: 'GET',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        accept: 'text/html',
      },
      timeoutMs: 20_000,
    },
    'duckduckgo',
    1,
  );
  if (!res.ok) throw new Error(`duckduckgo HTTP ${res.status}`);
  const html = await res.text();

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
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    links.push({ url, title: stripTags(m[2]) });
  }
  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) && snippets.length < maxResults * 2) {
    snippets.push(stripTags(m[1]));
  }
  for (let i = 0; i < links.length && results.length < maxResults; i++) {
    if (!links[i].url.startsWith('http')) continue;
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] ?? '',
    });
  }
  return results;
}

export async function webSearch(
  query: string,
  keys: ProviderKeys | undefined,
  maxResults = 5,
): Promise<WebSearchResult[]> {
  const capped = Math.max(1, Math.min(maxResults, 10));
  const tavily = keys?.tavily?.[0] || process.env.TAVILY_API_KEY;
  if (tavily) {
    try {
      return await tavilySearch(tavily, query, capped);
    } catch { /* fall through */ }
  }
  const brave = keys?.brave?.[0] || process.env.BRAVE_API_KEY;
  if (brave) {
    try {
      return await braveSearch(brave, query, capped);
    } catch { /* fall through */ }
  }
  return duckDuckGoSearch(query, capped);
}
