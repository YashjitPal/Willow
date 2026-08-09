// ──────────────────────────────────────────────────────────────────────────────
// The image proxy. Fetches a remote picture server-side and re-serves it, which
// is what Gemini does for every image on a response page.
//
// WHY. Measured on a live Gemini response, all 11 images come from Google-owned
// hosts (`encrypted-tbn{0,1,3}.gstatic.com`, `lh3.googleusercontent.com`,
// `www.gstatic.com`) and not one third-party URL is hotlinked. Their retrieval
// pipeline rewrites every picture through a proxy before the payload reaches the
// browser. Three things that buys, in order of how often they bite:
//
//   1. Hotlink refusal — many hosts 403 a request whose `Referer` is another
//      site. This request has no Referer and does not come from a page.
//   2. Mixed content — an `http://` image on an `https://` page is blocked by
//      the browser outright. Re-serving over https is the only fix.
//   3. Privacy — the publisher sees this function, not the user's IP.
//
// Only (2) and (3) actually need a server; (1) is also handled client-side by
// `referrerPolicy="no-referrer"` in `platform/ui/src/image-source.ts`, which is
// why this endpoint is optional and the client works without it.
//
// DEPLOYMENT. A zero-config Vercel function: any file under `/api` becomes an
// endpoint at that path, so this is `/api/image`. Nothing imports it and nothing
// bundles it — it is not part of the Vite build. On a host with no server
// (GitHub Pages) it simply never exists, and `configureImageProxy` is left
// unset, so images load directly with no referer.
//
// THE ALLOWLIST IS NOT OPTIONAL. Without one this is an open proxy: anyone can
// point `?url=` anywhere and use the deployment to fetch it, on its bandwidth,
// from its domain — which is how open proxies get conscripted into abuse. The
// default here is closed (`IMAGE_PROXY_HOSTS` unset = nothing allowed) rather
// than open, so a misconfiguration fails visibly instead of quietly shipping a
// relay.
// ──────────────────────────────────────────────────────────────────────────────

/** Big enough for any card or hero picture; small enough to bound the response. */
const MAX_BYTES = 12 * 1024 * 1024;
/** A slow publisher must not hold the function open for its whole budget. */
const TIMEOUT_MS = 10_000;

/**
 * Hosts this proxy will fetch from, as a comma-separated `IMAGE_PROXY_HOSTS`.
 *
 * A leading dot means "and its subdomains" (`.wikimedia.org` matches
 * `upload.wikimedia.org`); anything else is an exact host match. `*` allows
 * everything and exists only for a local experiment — it turns this into an open
 * proxy and must never be set on a public deployment.
 */
const allowedHosts = () =>
  String(process.env.IMAGE_PROXY_HOSTS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

const hostAllowed = (host, allowed) =>
  allowed.some((entry) =>
    entry === '*'
      ? true
      : entry.startsWith('.')
        ? host === entry.slice(1) || host.endsWith(entry)
        : host === entry
  );

/**
 * Content types that may be returned.
 *
 * Checked against what the upstream actually served, not against the URL, so a
 * `.jpg` that responds with HTML is refused. SVG is excluded deliberately: it is
 * a document, it can carry script, and serving one from our own origin would run
 * that script as us.
 */
const IMAGE_TYPES = /^image\/(a?png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|tiff)$/;

const fail = (res, status, reason) => {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // No-store on failures: a transient upstream error must not be cached as a
  // permanent one, and a rejection is cheap to recompute.
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error: reason }));
};

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return fail(res, 405, 'method not allowed');
  }

  const target = req.query?.url;
  if (!target || typeof target !== 'string') return fail(res, 400, 'missing url');

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return fail(res, 400, 'unparseable url');
  }
  // http is accepted on the way IN — upgrading a mixed-content image is one of
  // the reasons this endpoint exists. It leaves over https either way.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return fail(res, 400, 'unsupported protocol');
  }

  const allowed = allowedHosts();
  if (!allowed.length) return fail(res, 403, 'no hosts configured');
  if (!hostAllowed(parsed.hostname.toLowerCase(), allowed)) {
    return fail(res, 403, 'host not allowed');
  }

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(parsed.toString(), {
      signal: abort.signal,
      // `redirect: follow` is the default and is wanted — CDNs redirect
      // constantly — but each hop is re-checked below, or the allowlist would be
      // trivially bypassed by an allowed host redirecting anywhere.
      headers: {
        // No Referer and no cookies. A publisher checking for a hotlink sees a
        // bare request, which is the entire point.
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'User-Agent': 'Willow-Image-Proxy/1.0',
      },
    });
  } catch (error) {
    clearTimeout(timer);
    return fail(res, 504, error?.name === 'AbortError' ? 'upstream timeout' : 'upstream unreachable');
  }
  clearTimeout(timer);

  // Re-check the final URL: a 302 from an allowed host to an arbitrary one would
  // otherwise walk straight through the allowlist.
  try {
    const landed = new URL(upstream.url || parsed.toString());
    if (!hostAllowed(landed.hostname.toLowerCase(), allowed)) {
      return fail(res, 403, 'redirected off the allowlist');
    }
  } catch {
    return fail(res, 502, 'bad upstream url');
  }

  if (!upstream.ok) return fail(res, upstream.status === 404 ? 404 : 502, 'upstream ' + upstream.status);

  const type = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES.test(type)) return fail(res, 415, 'not an image');

  const declared = Number(upstream.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) return fail(res, 413, 'image too large');

  const buffer = Buffer.from(await upstream.arrayBuffer());
  // Checked again after reading: `Content-Length` is a claim, and a chunked
  // response has none at all.
  if (buffer.byteLength > MAX_BYTES) return fail(res, 413, 'image too large');

  res.status(200);
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', String(buffer.byteLength));
  // A card image is immutable for practical purposes and re-fetching it costs an
  // invocation, so it is cached hard at the edge. `stale-while-revalidate` keeps
  // a stale copy serving while one refresh happens behind it.
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
  // Belt and braces against the SVG case above: even if a type slipped through,
  // nosniff stops the browser deciding for itself that this is a document.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.end(req.method === 'HEAD' ? undefined : buffer);
}
