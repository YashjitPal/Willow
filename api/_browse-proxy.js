// ──────────────────────────────────────────────────────────────────────────────
// Spark's remote browser: any public page, served from a loopback origin of its
// own so an iframe can show it and Spark's browser agent can drive it.
//
// HOW. Every site gets its own origin under `.wb.localhost`. https://www.example.com
// is served as http://<base32 of "https://www.example.com">.wb.localhost:<port>,
// with the same path and query. To the page nothing changed but its host, so its
// own relative and root-relative URLs, `history.pushState`, same-origin fetches and
// cookies all keep working — which a `?url=` proxy or a <base> tag cannot give a
// script-heavy site. `*.localhost` resolves to loopback in every browser (RFC 6761),
// so there is nothing to configure, and Vite allows those hosts by default.
//
// WHAT CHANGES IN TRANSIT. Headers that would stop a page rendering in a frame are
// dropped (CSP, X-Frame-Options, COOP/COEP/CORP); redirects and cookies are
// rewritten onto the proxy host; HTML gets `_browse-bridge.js` injected as the
// first script of <head>. Willow is cross-origin to the page on purpose, and the
// bridge is how the browser agent screenshots and acts on it, over postMessage.
//
// WHERE IT RUNS. Host-based routing cannot work as a Vercel function, so this is
// not an endpoint (the underscore keeps Vercel from deploying it). The dev server
// mounts it from `apps/studio/vite.config.ts` and `bin/willow.js` mounts it in the
// local production server. Both run on the user's own machine, which is why they
// opt in; anywhere else it is closed unless `BROWSE_PROXY_ENABLED` is set, because
// a deployed open proxy is a relay for anyone who finds it.
//
// SSRF. A page must not use this to reach the user's network: hostnames that are
// private or resolve to a private address are refused, before every request and
// after every redirect.
// ──────────────────────────────────────────────────────────────────────────────

import { randomBytes } from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { isPrivateAddress, isPrivateHost } from './_private-host.js';

export const BROWSE_SUFFIX = 'wb.localhost';
const INTERNAL = '/__willow_browse__/';
const HTML_LIMIT = 8 * 1024 * 1024;
const BODY_LIMIT = 10 * 1024 * 1024;
const TIMEOUT_MS = 25_000;
const FALLBACK_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/* -------------------------------------------------------------------------- */
/* Origin <-> host label                                                       */
/* -------------------------------------------------------------------------- */

// RFC 4648 base32, lowercase and unpadded, so every character is valid in a DNS
// label. Labels are cut at 60 characters to stay under DNS's 63.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const LABEL = 60;

export const encodeOrigin = (origin) => {
  const bytes = Buffer.from(origin, 'utf8');
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  const labels = [];
  for (let at = 0; at < out.length; at += LABEL) labels.push(out.slice(at, at + LABEL));
  return labels.join('.');
};

export const decodeOrigin = (encoded) => {
  const text = encoded.replace(/\./g, '').toLowerCase();
  const bytes = [];
  let bits = 0;
  let value = 0;
  for (const char of text) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes).toString('utf8');
};

/** The proxy URL that serves `target` (an absolute http(s) URL). */
export const toBrowseUrl = (target, port) => {
  const url = new URL(target);
  return `http://${encodeOrigin(url.origin)}.${BROWSE_SUFFIX}${port ? `:${port}` : ''}${url.pathname}${url.search}${url.hash}`;
};

/** `{ origin, port }` for a proxy Host header, or null when the host is not one. */
export const parseBrowseHost = (host) => {
  const match = /^(.+)\.wb\.localhost(?::(\d+))?$/i.exec(String(host || ''));
  if (!match) return null;
  const origin = decodeOrigin(match[1]);
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.origin !== origin) return null;
  } catch {
    return null;
  }
  return { origin, port: match[2] || '' };
};

/* -------------------------------------------------------------------------- */
/* Guards and helpers                                                          */
/* -------------------------------------------------------------------------- */

class ProxyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Hostname → when its last public-address check expires. Pages fetch dozens of assets per host. */
const checkedHosts = new Map();
const CHECK_TTL_MS = 60_000;

const guardTarget = async (url) => {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProxyError(400, 'Only http and https pages can be opened.');
  }
  if (isPrivateHost(url.hostname)) {
    throw new ProxyError(403, 'Private and loopback addresses cannot be opened in the remote browser.');
  }
  if ((checkedHosts.get(url.hostname) ?? 0) > Date.now()) return;
  let addresses;
  try {
    addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new ProxyError(502, `${url.hostname}’s server IP address could not be found.`);
  }
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new ProxyError(403, `${url.hostname} resolves to a private address.`);
  }
  if (checkedHosts.size > 500) checkedHosts.clear();
  checkedHosts.set(url.hostname, Date.now() + CHECK_TTL_MS);
};

const BRIDGE_FILE = new URL('./_browse-bridge.js', import.meta.url);
let bridgeCache = null;
// Keyed on mtime so an edited bridge reaches the dev server without a restart.
const bridge = () => {
  const mtime = fs.statSync(BRIDGE_FILE).mtimeMs;
  if (bridgeCache?.mtime !== mtime) bridgeCache = { mtime, source: fs.readFileSync(BRIDGE_FILE, 'utf8') };
  return bridgeCache.source;
};

let html2canvasPath;
const html2canvasFile = () => {
  html2canvasPath ??= createRequire(import.meta.url).resolve('html2canvas/dist/html2canvas.min.js');
  return html2canvasPath;
};

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      reject(new ProxyError(413, 'The request body is too large.'));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

/** The real URL behind a proxy URL, or the input unchanged when it is not one. */
const toRealUrl = (value) => {
  try {
    const url = new URL(value);
    const parsed = parseBrowseHost(url.host);
    return parsed ? `${parsed.origin}${url.pathname}${url.search}${url.hash}` : value;
  } catch {
    return value;
  }
};

const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'cache-control',
  'content-type',
  'cookie',
  'if-match',
  'if-modified-since',
  'if-none-match',
  'pragma',
  'range',
  'user-agent',
];

const FORWARDED_RESPONSE_HEADERS = [
  'accept-ranges',
  'cache-control',
  'content-disposition',
  'content-language',
  'content-range',
  'content-type',
  'etag',
  'expires',
  'last-modified',
  'vary',
];

const upstreamHeaders = (req, { withCookies }) => {
  const headers = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers[name];
    if (value && (withCookies || name !== 'cookie')) headers[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  headers['user-agent'] ||= FALLBACK_USER_AGENT;
  headers['accept-language'] ||= 'en-US,en;q=0.9';
  if (req.headers.referer) headers.referer = toRealUrl(String(req.headers.referer));
  if (req.headers.origin) {
    const origin = toRealUrl(String(req.headers.origin));
    try {
      headers.origin = new URL(origin).origin;
    } catch {
      // Drop an origin that does not parse.
    }
  }
  return headers;
};

/** Moves a cookie onto the proxy host: no Domain, and usable inside Willow's frame. */
const rewriteSetCookie = (cookie) => {
  const parts = cookie.split(';').map((part) => part.trim()).filter(Boolean);
  const kept = parts.filter((part, index) => index === 0 || !/^(domain|samesite|secure|partitioned)\b/i.test(part));
  return [...kept, 'SameSite=None', 'Secure', 'Partitioned'].join('; ');
};

const charsetOf = (contentType, bytes) => {
  const declared = /charset\s*=\s*["']?([\w:.-]+)/i.exec(contentType || '')?.[1];
  if (declared) return declared;
  const head = bytes.subarray(0, 4096).toString('latin1');
  return /<meta[^>]+charset\s*=\s*["']?([\w:.-]+)/i.exec(head)?.[1] || 'utf-8';
};

const decodeHtml = (bytes, contentType) => {
  try {
    return new TextDecoder(charsetOf(contentType, bytes)).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
};

/*
 * On the real site a scheme-less URL ("//upload.example.org/a.png") takes https
 * from the page; here the page is the proxy's http, so it would go to the real host
 * over plain http, which hangs on hosts that only serve TLS (Wikimedia's image hosts
 * do) — broken images, and a screenshot that waits for them to time out. The
 * policy upgrades those requests, and any http subresource a script builds later,
 * the way an https page's own mixed-content handling would. `*.localhost` is a
 * secure origin, so the proxy's own requests are left alone.
 */
const UPGRADE_INSECURE = '<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">';

export const injectBridge = (html, origin) => {
  const config = JSON.stringify({ origin, suffix: BROWSE_SUFFIX }).replace(/</g, '\\u003c');
  const source = bridge();
  const at = source.lastIndexOf('__WILLOW_BROWSE_CONFIG__');
  const filled = `${source.slice(0, at)}${config}${source.slice(at + '__WILLOW_BROWSE_CONFIG__'.length)}`;
  const script = `<script data-willow-browse>${filled.replace(/<\/script/gi, '<\\/script')}</script>${
    origin.startsWith('https:') ? UPGRADE_INSECURE : ''
  }`;
  const cleaned = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy[^>]*>/gi, '');
  const anchor = /<head\b[^>]*>/i.exec(cleaned) ?? /<html\b[^>]*>/i.exec(cleaned);
  if (anchor) {
    const end = anchor.index + anchor[0].length;
    return `${cleaned.slice(0, end)}${script}${cleaned.slice(end)}`;
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(cleaned);
  if (doctype) return `${doctype[0]}${script}${cleaned.slice(doctype[0].length)}`;
  return `${script}${cleaned}`;
};

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
));

/**
 * Chrome's own error page, in outline, so a page that cannot be reached reads the
 * way it would in the remote browser — for the user and for the agent's screenshot.
 */
const errorPage = (url, message, origin) => injectBridge(`<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(url.hostname)}</title>
<style>
  html { background: #fff; }
  body { margin: 0; font: 15px/1.6 Roboto, "Segoe UI", Arial, sans-serif; color: #1f1f1f; }
  main { max-width: 600px; margin: 14vh auto 0; padding: 0 32px; }
  .icon { width: 72px; height: 72px; margin-bottom: 40px; }
  h1 { margin: 0 0 16px; font-size: 24px; font-weight: 400; line-height: 1.25; }
  p { margin: 0 0 8px; color: #474747; }
  code { font: 12px/1.6 Roboto Mono, Consolas, monospace; color: #474747; text-transform: uppercase; }
</style></head>
<body><main>
  <svg class="icon" viewBox="0 0 72 72" aria-hidden="true"><path fill="#474747" d="M9 18h54v36H9z" opacity=".12"/><path fill="#474747" d="M12 21h48v30H12zm-3-3v36h54V18zm18 42h18v3H27z"/><path fill="#fff" d="M33 30h6v9h-6zm0 12h6v4h-6z"/></svg>
  <h1>This site can’t be reached</h1>
  <p>${escapeHtml(message)}</p>
  <code>ERR_CONNECTION_FAILED</code>
</main></body></html>`, origin);

const send = (res, status, body, contentType = 'text/plain; charset=utf-8') => {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
};

/* -------------------------------------------------------------------------- */
/* Handlers                                                                    */
/* -------------------------------------------------------------------------- */

const fetchUpstream = async (target, req, { withCookies, signal }) => {
  await guardTarget(target);
  const method = (req.method || 'GET').toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);
  try {
    return await fetch(target, {
      method,
      headers: upstreamHeaders(req, { withCookies }),
      body,
      redirect: 'manual',
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw new ProxyError(504, `${target.hostname} took too long to respond.`);
    throw new ProxyError(502, `${target.hostname} refused to connect.`);
  }
};

const copyHeaders = (upstream, res, port, { cors }) => {
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  const location = upstream.headers.get('location');
  if (location) {
    try {
      const next = new URL(location, upstream.url);
      res.setHeader('Location', next.protocol === 'http:' || next.protocol === 'https:' ? toBrowseUrl(next.href, port) : location);
    } catch {
      // A Location that does not parse is dropped rather than followed.
    }
  }
  const cookies = typeof upstream.headers.getSetCookie === 'function' ? upstream.headers.getSetCookie() : [];
  if (cookies.length) res.setHeader('Set-Cookie', cookies.map(rewriteSetCookie));
  if (cors) res.setHeader('Access-Control-Allow-Origin', '*');
};

const pipeBody = (upstream, res) => {
  if (!upstream.body) {
    res.end();
    return;
  }
  const stream = Readable.fromWeb(upstream.body);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
};

/** Aborts the upstream fetch if the browser goes away before the response is done. */
const abortOnHangUp = (res) => {
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) abort.abort();
  });
  return abort;
};

/*
 * Post/redirect/get. A page that answered a POST would sit in the frame's history
 * as a POST entry, and going back to it needs the form resubmitted — Chrome shows
 * its resubmit prompt instead, which has no bridge for the agent to act through.
 * So the result is held here and the frame is sent to a GET URL that serves it.
 */
export const POST_PARAM = '__willow_post';
const POST_TTL_MS = 30 * 60_000;
const POST_LIMIT = 40;
const postedPages = new Map();

const rememberPostedPage = (html) => {
  const now = Date.now();
  for (const [token, page] of postedPages) if (page.expires < now) postedPages.delete(token);
  while (postedPages.size >= POST_LIMIT) postedPages.delete(postedPages.keys().next().value);
  const token = randomBytes(12).toString('base64url');
  postedPages.set(token, { html, expires: now + POST_TTL_MS });
  return token;
};

/** `path` with the post token taken out, and the token. */
export const splitPostToken = (path) => {
  const match = new RegExp(`([?&])${POST_PARAM}=([^&#]*)&?`).exec(path);
  if (!match) return { path, token: null };
  const stripped = `${path.slice(0, match.index)}${match[1]}${path.slice(match.index + match[0].length)}`;
  return { path: stripped.replace(/[?&](?=#|$)/, ''), token: decodeURIComponent(match[2]) };
};

const withPostToken = (path, token) => {
  const hash = path.indexOf('#');
  const base = hash < 0 ? path : path.slice(0, hash);
  return `${base}${base.includes('?') ? '&' : '?'}${POST_PARAM}=${token}`;
};

const proxyPage = async (req, res, origin, port) => {
  const method = (req.method || 'GET').toUpperCase();
  const { path: requestPath, token: postToken } = splitPostToken(req.url || '/');
  if (postToken !== null && method === 'GET') {
    const saved = postedPages.get(postToken);
    if (saved && saved.expires > Date.now()) {
      send(res, 200, saved.html, 'text/html; charset=utf-8');
      return;
    }
  }
  const target = new URL(requestPath, origin);
  const destination = String(req.headers['sec-fetch-dest'] || 'document');
  const wantsDocument = (destination === 'document' || destination === 'iframe')
    && /text\/html/i.test(String(req.headers.accept || ''));
  const abort = abortOnHangUp(res);
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetchUpstream(target, req, { withCookies: true, signal: abort.signal });
  } catch (error) {
    clearTimeout(timer);
    const status = error instanceof ProxyError ? error.status : 502;
    const message = error instanceof ProxyError ? error.message : `${target.hostname} refused to connect.`;
    if (wantsDocument) send(res, status, errorPage(target, message, origin), 'text/html; charset=utf-8');
    else send(res, status, message);
    return;
  }
  clearTimeout(timer);

  res.statusCode = upstream.status;
  copyHeaders(upstream, res, port, { cors: false });
  const type = (upstream.headers.get('content-type') || '').toLowerCase();
  const isHtml = type.includes('text/html') || type.includes('application/xhtml+xml');
  if (!isHtml || method === 'HEAD' || upstream.status === 204 || upstream.status === 304) {
    pipeBody(upstream, res);
    return;
  }
  const declared = Number(upstream.headers.get('content-length') || 0);
  if (declared > HTML_LIMIT) {
    send(res, 413, errorPage(target, 'This page is too large to open in the remote browser.', origin), 'text/html; charset=utf-8');
    return;
  }
  const bytes = Buffer.from(await upstream.arrayBuffer());
  if (bytes.byteLength > HTML_LIMIT) {
    send(res, 413, errorPage(target, 'This page is too large to open in the remote browser.', origin), 'text/html; charset=utf-8');
    return;
  }
  const html = injectBridge(decodeHtml(bytes, type), origin);
  if (method === 'POST' && wantsDocument && upstream.status === 200) {
    for (const name of res.getHeaderNames()) if (name !== 'set-cookie') res.removeHeader(name);
    res.statusCode = 303;
    res.setHeader('Location', withPostToken(requestPath, rememberPostedPage(html)));
    res.setHeader('Cache-Control', 'no-store');
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(html);
};

/** Any URL, fetched for a page's cross-origin requests and html2canvas's images. */
const proxyRaw = async (req, res, port) => {
  const value = new URL(req.url || '/', 'http://proxy.invalid').searchParams.get('url');
  let target;
  try {
    target = new URL(value || '');
  } catch {
    send(res, 400, 'missing url');
    return;
  }
  const abort = abortOnHangUp(res);
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetchUpstream(target, req, { withCookies: false, signal: abort.signal });
    clearTimeout(timer);
    res.statusCode = upstream.status;
    copyHeaders(upstream, res, port, { cors: true });
    res.removeHeader('Set-Cookie');
    pipeBody(upstream, res);
  } catch (error) {
    clearTimeout(timer);
    send(res, error instanceof ProxyError ? error.status : 502, error instanceof Error ? error.message : 'fetch failed');
  }
};

const serveHtml2canvas = (res) => {
  try {
    const source = fs.readFileSync(html2canvasFile());
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(source);
  } catch {
    send(res, 500, 'html2canvas is not installed');
  }
};

/**
 * Answers a request when its Host is a remote-browser host, and returns whether it
 * did. Anything else is left to the caller's own routing.
 */
export const handleBrowseRequest = async (req, res, { enabled = Boolean(process.env.BROWSE_PROXY_ENABLED) } = {}) => {
  const parsed = parseBrowseHost(req.headers.host);
  if (!parsed) return false;
  if (!enabled) {
    send(res, 403, 'The remote browser is not enabled on this server.');
    return true;
  }
  const path = (req.url || '/').split('?')[0];
  try {
    if (path === `${INTERNAL}html2canvas.js`) serveHtml2canvas(res);
    else if (path === `${INTERNAL}raw`) await proxyRaw(req, res, parsed.port);
    else await proxyPage(req, res, parsed.origin, parsed.port);
  } catch (error) {
    send(res, 502, error instanceof Error ? error.message : 'remote browser error');
  }
  return true;
};
