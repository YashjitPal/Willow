// ──────────────────────────────────────────────────────────────────────────────
// How a remote image gets fetched — one decision, made in one place.
//
// WHY THIS EXISTS. Gemini never paints a publisher's URL. Measured across all 11
// images on a live response page, every one is served from a Google-owned host
// (`encrypted-tbn{0,1,3}.gstatic.com/licensed-image`, `/images`,
// `lh3.googleusercontent.com`, `www.gstatic.com`); not one third-party URL is
// hotlinked. The retrieval pipeline resolves a picture server-side and rewrites
// it through an image proxy before the payload reaches the browser, so the client
// only ever handles URLs guaranteed to load, carrying no hotlink protection and
// leaking no referer to the publisher.
//
// Willow's model, by contrast, hands us whatever URL it found. Three things then
// go wrong, and they need different fixes:
//
//  1. HOTLINK REFUSAL. Many hosts check the `Referer` and serve a 403 to a
//     request that came from another site's page. Fixed on the client:
//     `referrerPolicy="no-referrer"` sends no `Referer` at all, so there is
//     nothing to check. Costs nothing and needs no server.
//  2. MIXED CONTENT. An `http://` image on an `https://` page is blocked by the
//     browser before a request is even made. No client-side setting fixes this;
//     it needs something to re-serve the bytes over https.
//  3. PRIVACY. Without a proxy every card image tells that publisher the user's
//     IP and which page they were on.
//
// So (1) is unconditional and (2)(3) are what the proxy is for. The proxy is
// OPTIONAL by design: unconfigured, images load directly with no referer, which
// is strictly better than today and requires no deployment. Configured, they go
// through `endpoint`.
//
// WHY THE ENDPOINT IS INJECTED. `platform/ui` reads no environment of its own —
// it is consumed by the studio app, by tests, and by Node (`importTs`), and
// `import.meta.env` exists in only one of those. The app decides and calls
// `configureImageProxy` once at startup; everything else asks this module.
//
// ONE FETCH, NOT TWO. An earlier revision painted a card's picture as a CSS
// `background-image` and probed the same URL a second time off-DOM with
// `new Image()`, because CSS has no error event and a blank tile had to be
// detected somehow. Two fetches under two different referrer policies is a trap:
// a probe that can load where the paint cannot reports success and still leaves
// an empty card. Every image is now a real `<img>` — one request, its own
// `referrerPolicy`, its own `onError` — so the two can no longer disagree.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Sent on every remote image, and on the probe that tests one.
 *
 * `no-referrer` rather than `no-referrer-when-downgrade` or `origin`: the point
 * is that the publisher cannot tell this was a hotlink, and an origin header
 * still says "another site".
 */
export const IMAGE_REFERRER_POLICY = 'no-referrer' as const;

let proxyEndpoint: string | null = null;

/**
 * Point remote images at a proxy, or pass `null` to load them directly.
 *
 * Called once at app startup. Kept as a setter rather than a build-time constant
 * so the same UI package works in the studio app, in tests and under Node.
 */
export const configureImageProxy = (endpoint: string | null | undefined): void => {
  const trimmed = typeof endpoint === 'string' ? endpoint.trim() : '';
  proxyEndpoint = trimmed || null;
};

/** The configured endpoint, or `null`. Exported for tests and diagnostics. */
export const getImageProxyEndpoint = (): string | null => proxyEndpoint;

/**
 * True when `url` is a remote picture a proxy could help with.
 *
 * Deliberately narrow. `data:` and `blob:` URLs are already local and would be
 * corrupted by a round trip. A relative or same-origin URL is ours and needs no
 * help. Anything that does not parse is left alone rather than guessed at — the
 * caller's `onError` handles it, and inventing a proxy request for a malformed
 * URL would turn a visible broken image into a confusing server error.
 */
export const isProxyableImageUrl = (url: string): boolean => {
  if (!url) return false;
  let parsed: URL;
  try {
    // A base is required for the relative case, and its absence is the signal:
    // if there is no document to be relative to, a bare path is not remote.
    const base = typeof document === 'undefined' ? undefined : document.baseURI;
    parsed = base ? new URL(url, base) : new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (typeof window !== 'undefined' && parsed.origin === window.location.origin) return false;
  return true;
};

/**
 * The URL to actually put in `src`.
 *
 * Returns `url` untouched when no proxy is configured or the URL is not one a
 * proxy applies to, so every call site can use this unconditionally.
 */
export const resolveImageSource = (url: string | undefined): string | undefined => {
  if (!url) return url;
  if (!proxyEndpoint || !isProxyableImageUrl(url)) return url;
  return proxyEndpoint + (proxyEndpoint.includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(url);
};
