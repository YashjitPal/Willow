// ──────────────────────────────────────────────────────────────────────────────
// The SSRF guard shared by the server-side fetchers (`fetch-source.js`,
// `_browse-proxy.js`). The leading underscore keeps Vercel from deploying this
// file as an endpoint of its own.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Whether an IP address literal is private, loopback, link-local or otherwise not
 * a public internet address.
 */
export const isPrivateAddress = (address) => {
  const host = String(address).toLowerCase().replace(/^\[|\]$/g, '');
  if (host === '::1' || host === '0:0:0:0:0:0:0:1' || host === '::') return true;
  // IPv4-mapped IPv6 (::ffff:127.0.0.1) is judged by the IPv4 it carries.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (mapped) return isPrivateAddress(mapped[1]);
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

/**
 * Hostnames and address literals that must never be fetched.
 *
 * Even on a local machine this matters: a page cannot be allowed to use a
 * server-side fetcher to reach the user's router, NAS or a service bound to
 * loopback. Cloud metadata endpoints (169.254.169.254) are the classic target and
 * are covered by the link-local range.
 */
export const isPrivateHost = (hostname) => {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  return isPrivateAddress(host);
};
