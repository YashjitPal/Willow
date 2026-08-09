/**
 * The image proxy's request handling — `api/image.js`.
 *
 * THE ALLOWLIST IS THE WHOLE POINT. Without one this endpoint is an open proxy:
 * anyone can point `?url=` at anything and use the deployment to fetch it, on
 * its bandwidth, from its domain. Open image proxies get found and conscripted,
 * so the failure mode has to be closed-by-default and the bypasses have to be
 * tested rather than reasoned about — particularly the redirect one, where an
 * allowed host 302s somewhere that is not.
 *
 * `fetch` is stubbed on `globalThis` so nothing here touches the network.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const handlerUrl = new URL(
  'file:///' + path.join(repoRoot, 'api', 'image.js').replace(/\\/g, '/')
);

const loadHandler = async () => (await import(handlerUrl.href)).default;

/** Minimal stand-in for the Node response Vercel hands the function. */
const makeRes = () => {
  const res = {
    statusCode: 0,
    headers: {},
    body: undefined,
    ended: false,
    status(code) { res.statusCode = code; return res; },
    setHeader(name, value) { res.headers[name.toLowerCase()] = value; },
    end(body) { res.body = body; res.ended = true; },
  };
  return res;
};

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

/** Run the handler with `fetch` replaced for the duration. */
const run = async ({ url, hosts, fetchImpl, method = 'GET' }) => {
  const handler = await loadHandler();
  const priorFetch = globalThis.fetch;
  const priorHosts = process.env.IMAGE_PROXY_HOSTS;
  if (hosts === undefined) delete process.env.IMAGE_PROXY_HOSTS;
  else process.env.IMAGE_PROXY_HOSTS = hosts;
  if (fetchImpl) globalThis.fetch = fetchImpl;
  const res = makeRes();
  try {
    await handler({ method, query: { url } }, res);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorHosts === undefined) delete process.env.IMAGE_PROXY_HOSTS;
    else process.env.IMAGE_PROXY_HOSTS = priorHosts;
  }
  return res;
};

/** An upstream that answers every request the same way. */
const respond = ({ status = 200, type = 'image/png', body = PNG, url, length } = {}) =>
  async (requested) => ({
    ok: status >= 200 && status < 300,
    status,
    url: url || requested,
    headers: {
      get: (name) => {
        const key = String(name).toLowerCase();
        if (key === 'content-type') return type;
        if (key === 'content-length') return length == null ? String(body.byteLength) : String(length);
        return null;
      },
    },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  });

// ── Closed by default ───────────────────────────────────────────────────────

it('refuses everything when no hosts are configured', async () => {
  // A misconfigured deployment must fail visibly, not quietly become a relay.
  const res = await run({ url: 'https://example.com/a.png', hosts: undefined });
  assert.equal(res.statusCode, 403);
  assert.match(String(res.body), /no hosts configured/);
});

it('refuses a host that is not on the list', async () => {
  const res = await run({ url: 'https://evil.test/a.png', hosts: 'example.com' });
  assert.equal(res.statusCode, 403);
  assert.match(String(res.body), /host not allowed/);
});

it('matches subdomains only for a leading-dot entry', async () => {
  const allowed = await run({
    url: 'https://upload.wikimedia.org/a.png',
    hosts: '.wikimedia.org',
    fetchImpl: respond(),
  });
  assert.equal(allowed.statusCode, 200);

  // A bare entry is an exact host, so it must not pull in its subdomains.
  const refused = await run({
    url: 'https://upload.wikimedia.org/a.png',
    hosts: 'wikimedia.org',
    fetchImpl: respond(),
  });
  assert.equal(refused.statusCode, 403);
});

it('does not let a suffix match steal a lookalike domain', async () => {
  // `.example.com` must not match `notexample.com`, which a naive endsWith on
  // the undotted form would allow.
  const res = await run({
    url: 'https://notexample.com/a.png',
    hosts: '.example.com',
    fetchImpl: respond(),
  });
  assert.equal(res.statusCode, 403);
});

// ── The redirect bypass ─────────────────────────────────────────────────────

it('re-checks the host after a redirect', async () => {
  // The bypass that matters: an allowed host 302s to one that is not, and the
  // allowlist is walked straight through unless the landing URL is checked too.
  const res = await run({
    url: 'https://example.com/a.png',
    hosts: 'example.com',
    fetchImpl: respond({ url: 'https://evil.test/a.png' }),
  });
  assert.equal(res.statusCode, 403);
  assert.match(String(res.body), /redirected off the allowlist/);
});

it('allows a redirect that stays on the list', async () => {
  const res = await run({
    url: 'https://example.com/a.png',
    hosts: 'example.com,cdn.example.net',
    fetchImpl: respond({ url: 'https://cdn.example.net/a.png' }),
  });
  assert.equal(res.statusCode, 200);
});

// ── What may come back ──────────────────────────────────────────────────────

it('refuses a response that is not an image, whatever the url said', async () => {
  // Checked against what was actually served, not the extension: a `.jpg` that
  // answers with HTML is a login page or an error, not a picture.
  const res = await run({
    url: 'https://example.com/a.jpg',
    hosts: 'example.com',
    fetchImpl: respond({ type: 'text/html' }),
  });
  assert.equal(res.statusCode, 415);
});

it('refuses SVG, which is a document that can carry script', async () => {
  // Served from our own origin, an SVG's script would run as us.
  const res = await run({
    url: 'https://example.com/a.svg',
    hosts: 'example.com',
    fetchImpl: respond({ type: 'image/svg+xml' }),
  });
  assert.equal(res.statusCode, 415);
});

it('passes a real image through with its type intact', async () => {
  const res = await run({
    url: 'https://example.com/a.png',
    hosts: 'example.com',
    fetchImpl: respond(),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/png');
  assert.ok(Buffer.isBuffer(res.body));
  assert.equal(res.body.byteLength, PNG.byteLength);
  // Belt and braces on the SVG rule above: even a type that slipped through
  // must not be re-sniffed into a document by the browser.
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  // Re-fetching a card image costs an invocation, so it is cached at the edge.
  assert.match(res.headers['cache-control'], /s-maxage=\d+/);
});

it('caps the response by what actually arrived, not by what was claimed', async () => {
  // `Content-Length` is a claim, and a chunked response has none at all — so
  // the size has to be re-checked after reading or the cap is advisory.
  const big = Buffer.alloc(13 * 1024 * 1024);
  const res = await run({
    url: 'https://example.com/a.png',
    hosts: 'example.com',
    fetchImpl: respond({ body: big, length: 10 }),
  });
  assert.equal(res.statusCode, 413);
});

// ── Bad requests ────────────────────────────────────────────────────────────

it('rejects a missing or unparseable url before doing any work', async () => {
  const missing = await run({ url: undefined, hosts: 'example.com' });
  assert.equal(missing.statusCode, 400);
  const bad = await run({ url: 'http://[', hosts: 'example.com' });
  assert.equal(bad.statusCode, 400);
});

it('rejects a non-http protocol', async () => {
  // `file:` would read the function's own filesystem.
  for (const url of ['file:///etc/passwd', 'data:image/png;base64,AA']) {
    const res = await run({ url, hosts: '*' });
    assert.equal(res.statusCode, 400, url);
  }
});

it('accepts http on the way in, because upgrading it is a reason it exists', async () => {
  // An http:// image is blocked outright on an https:// page and no client-side
  // setting can fix it. It leaves this function over https either way.
  const res = await run({
    url: 'http://example.com/a.png',
    hosts: 'example.com',
    fetchImpl: respond(),
  });
  assert.equal(res.statusCode, 200);
});

it('answers an upstream failure without caching it', async () => {
  const res = await run({
    url: 'https://example.com/a.png',
    hosts: 'example.com',
    fetchImpl: respond({ status: 404 }),
  });
  assert.equal(res.statusCode, 404);
  // A transient upstream error must not be cached at the edge as a permanent one.
  assert.match(res.headers['cache-control'], /no-store/);
});

it('turns an unreachable upstream into a gateway error, not a crash', async () => {
  const res = await run({
    url: 'https://example.com/a.png',
    hosts: 'example.com',
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
  });
  assert.equal(res.statusCode, 504);
});

it('reports a timeout distinctly from an unreachable host', async () => {
  const res = await run({
    url: 'https://example.com/a.png',
    hosts: 'example.com',
    fetchImpl: async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    },
  });
  assert.equal(res.statusCode, 504);
  assert.match(String(res.body), /timeout/);
});

it('refuses methods that are not a read', async () => {
  const res = await run({ url: 'https://example.com/a.png', hosts: 'example.com', method: 'POST' });
  assert.equal(res.statusCode, 405);
  assert.match(String(res.headers.allow), /GET/);
});
