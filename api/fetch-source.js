// ──────────────────────────────────────────────────────────────────────────────
// Website source fetcher. Downloads a page server-side and returns its text, so
// a notebook can be grounded on a URL the browser is not allowed to read.
//
// WHY IT EXISTS. The same-origin policy forbids a page from reading another
// site's contents, so "add a website as a source" cannot be done in the browser
// at all. Gemini solves it the same way: its docs say a source URL is scraped at
// the moment it is added and stored as a static copy — "only the text content of
// the given HTML webpage", with images, embedded video and nested pages ignored —
// and nothing is re-fetched per question. This reproduces that shape.
//
// WHY HERE, AND NOT ON THE AGENTS BACKEND. `services/agent-builder` can already
// extract document text and is mounted same-origin in dev, so it was the obvious
// host. It was not chosen: that package owns the workflow engine, its runs and
// its SQLite database, and a URL fetcher is not part of that. Putting it there
// would make notebook sources depend on an unrelated service being deployed. This
// is the same seam `api/image.js` uses for the same class of problem — a zero-
// config function, no new process, nothing to start.
//
// DEPLOYMENT. Any file under `/api` becomes an endpoint at that path on Vercel,
// so this is `/api/fetch-source`. Nothing imports it into the bundle. Under
// `npm run dev` the Vite plugin in `apps/studio/vite.config.ts` mounts this same
// handler, so the two environments run identical code.
//
// FAIL CLOSED. On a public deployment an unrestricted "fetch any URL and give me
// its text" endpoint is both an open scraping relay and an SSRF hole — a visitor
// could aim it at the host's own network. So it is **off unless
// `SOURCE_FETCH_ENABLED` is set**, exactly as the image proxy is closed until its
// allowlist is. The dev plugin sets it automatically, because there the
// "deployment" is the user's own machine and fetching arbitrary public pages is
// the entire point. An allowlist is deliberately NOT used here: the user is
// adding arbitrary sources, so a host list would defeat the feature.
// ──────────────────────────────────────────────────────────────────────────────

/** HTML beyond this is a document dump, not an article. */
const MAX_BYTES = 5 * 1024 * 1024;
/** Extracted text cap. Well under the per-source storage bound in the client. */
const MAX_TEXT_CHARS = 400_000;
const TIMEOUT_MS = 15_000;

/**
 * Hostnames and address literals that must never be fetched.
 *
 * This is the SSRF guard. Even on a local machine it matters: a page cannot be
 * allowed to use this endpoint to reach the user's router, NAS or a service bound
 * to loopback. Cloud metadata endpoints (169.254.169.254) are the classic target
 * and are covered by the link-local range.
 */
const isPrivateHost = (hostname) => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return false;
  const [a, b] = v4.slice(1).map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // Carrier-grade NAT, and 100.100.x is a metadata endpoint on some clouds.
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
};

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'",
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
};

const decodeEntities = (text) =>
  text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, name) => {
    const key = name.toLowerCase();
    if (ENTITIES[key]) return ENTITIES[key];
    if (key.startsWith('#x')) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith('#')) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return match;
  });

/**
 * HTML → text, by stripping rather than parsing.
 *
 * No DOM library on purpose: this runs as a dependency-free function, and the
 * goal is grounding text rather than a faithful document tree. Order matters —
 * `script`, `style` and friends are removed WITH their contents first, or their
 * bodies survive as text and a page's JavaScript ends up in the source.
 *
 * Block-level tags become newlines before the rest are dropped, so paragraphs and
 * list items stay separated; without that the whole page collapses into one line
 * and every downstream chunker sees a single paragraph.
 */
const htmlToText = (html) => {
  const withoutHead = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|canvas|iframe|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');
  const withBreaks = withoutHead
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ');
  return decodeEntities(withBreaks.replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const titleOf = (html) => {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (og) return decodeEntities(og[1]).trim();
  const tag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return tag ? decodeEntities(tag[1]).replace(/\s+/g, ' ').trim() : '';
};

const send = (res, status, payload) => {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { error: 'method not allowed' });
  }
  if (!process.env.SOURCE_FETCH_ENABLED) {
    return send(res, 403, { error: 'source fetching is not enabled on this deployment' });
  }

  // `req.query` on Vercel; parsed from the path under the dev middleware, which
  // has no query parser of its own.
  const target = req.query?.url
    ?? new URL(req.url ?? '', 'http://localhost').searchParams.get('url');
  if (!target || typeof target !== 'string') return send(res, 400, { error: 'missing url' });

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return send(res, 400, { error: 'unparseable url' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return send(res, 400, { error: 'only http and https are supported' });
  }
  if (isPrivateHost(parsed.hostname)) {
    return send(res, 403, { error: 'refusing to fetch a private or loopback address' });
  }
  // Credentials in a source URL would be stored in the notebook and sent upstream.
  parsed.username = '';
  parsed.password = '';

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(parsed.toString(), {
      signal: abort.signal,
      redirect: 'follow',
      headers: {
        // A plain browser-ish Accept and UA. Some publishers serve a stub to
        // unknown agents, and identifying honestly is better than spoofing Chrome.
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        'User-Agent': 'Willow-Notebook-Source/1.0 (+https://github.com/willow)',
        'Accept-Language': 'en',
      },
    });
  } catch (error) {
    clearTimeout(timer);
    return send(res, 504, {
      error: error?.name === 'AbortError' ? 'the page took too long to respond' : 'could not reach that page',
    });
  }
  clearTimeout(timer);

  // Re-check after redirects: an allowed public host can redirect to loopback,
  // which is the standard way an SSRF guard on the first URL alone is bypassed.
  try {
    const landed = new URL(upstream.url || parsed.toString());
    if (isPrivateHost(landed.hostname)) {
      return send(res, 403, { error: 'redirected to a private address' });
    }
  } catch {
    return send(res, 502, { error: 'bad upstream url' });
  }

  if (!upstream.ok) {
    return send(res, upstream.status === 404 ? 404 : 502, {
      error: `the page returned ${upstream.status}`,
    });
  }

  const type = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  // A URL that serves a PDF is a real case; say so plainly rather than returning
  // the binary as text, so the client can tell the user to download and attach it.
  if (type === 'application/pdf') {
    return send(res, 415, { error: 'that URL is a PDF — download it and add it as a file' });
  }
  const isText = type.startsWith('text/') || type === 'application/xhtml+xml' || type === 'application/xml';
  if (type && !isText) return send(res, 415, { error: `that URL served ${type}, not a web page` });

  const declared = Number(upstream.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) return send(res, 413, { error: 'that page is too large' });

  const buffer = Buffer.from(await upstream.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) return send(res, 413, { error: 'that page is too large' });

  const html = buffer.toString('utf8');
  const text = type === 'text/plain' ? html.trim() : htmlToText(html);
  if (!text) {
    return send(res, 422, {
      error: 'no readable text — the page may build itself with JavaScript, or be behind a paywall',
    });
  }

  return send(res, 200, {
    url: upstream.url || parsed.toString(),
    title: titleOf(html) || parsed.hostname,
    text: text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text,
    truncated: text.length > MAX_TEXT_CHARS,
  });
}
