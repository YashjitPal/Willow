/**
 * Where a page lives in Spark's remote browser.
 *
 * `api/_browse-proxy.js` serves every site from a loopback origin of its own:
 * https://www.example.com is http://<base32 of "https://www.example.com">.wb.localhost:<port>
 * with the same path. This is the client half of that mapping and has to stay
 * byte-for-byte compatible with the proxy's `encodeOrigin` — a test pins the two.
 */

export const BROWSE_SUFFIX = 'wb.localhost';

/** Where the browser agent's `search` action goes. Google serves automated traffic a CAPTCHA. */
export const SEARCH_HOME = 'https://html.duckduckgo.com/html/';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const LABEL = 60;

export const encodeOrigin = (origin: string): string => {
  const bytes = new TextEncoder().encode(origin);
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
  const labels: string[] = [];
  for (let at = 0; at < out.length; at += LABEL) labels.push(out.slice(at, at + LABEL));
  return labels.join('.');
};

export const decodeOrigin = (encoded: string): string | null => {
  const text = encoded.replace(/\./g, '').toLowerCase();
  const bytes: number[] = [];
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
  return new TextDecoder().decode(new Uint8Array(bytes));
};

/**
 * A URL as the user would type it, made absolute: a bare host gains `https://`.
 * Null for anything that is not an http(s) page.
 */
export const normalizeBrowseTarget = (input: string): string | null => {
  const raw = input.trim();
  if (!raw) return null;
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
};

/** The proxy URL that shows `target` in the remote browser, on Willow's own port. */
export const toBrowseUrl = (target: string, port = typeof location === 'undefined' ? '' : location.port): string => {
  const url = new URL(target);
  return `http://${encodeOrigin(url.origin)}.${BROWSE_SUFFIX}${port ? `:${port}` : ''}${url.pathname}${url.search}${url.hash}`;
};

/** The real page behind a proxy URL, or the input unchanged when it is not one. */
export const fromBrowseUrl = (value: string): string => {
  try {
    const url = new URL(value);
    const suffix = `.${BROWSE_SUFFIX}`;
    if (!url.hostname.endsWith(suffix)) return value;
    const origin = decodeOrigin(url.hostname.slice(0, -suffix.length));
    // The proxy's post/redirect/get token is not part of the page's address.
    const search = url.search.replace(/([?&])__willow_post=[^&#]*&?/, '$1').replace(/[?&]$/, '');
    return origin ? `${origin}${url.pathname}${search}${url.hash}` : value;
  } catch {
    return value;
  }
};

/**
 * How Chrome's omnibox prints a URL once the page has loaded: no scheme, and no
 * `www.` — "wolframalpha.com/input?i=distance+from+Earth+to+the+Moon".
 */
export const displayUrl = (value: string): string => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return value;
    const host = url.host.replace(/^www\./, '');
    const rest = `${url.pathname === '/' ? '' : url.pathname}${url.search}${url.hash}`;
    return `${host}${rest}`;
  } catch {
    return value;
  }
};
