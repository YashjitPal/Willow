/**
 * `/llm-proxy`: forwards a request to the provider endpoint named in its
 * `x-proxy-target` header.
 *
 * Custom AI gateways often do not answer CORS preflights, so when Willow runs
 * on localhost it sends their requests here (`platform/ai/src/providers/
 * endpoints.ts` decides). Willow's own server mounts this — `bin/willow.js`,
 * which `npx willow-studio` and the desktop app run. The dev server has the
 * same middleware inline in `apps/studio/vite.config.ts` (`dynamicLlmProxy`);
 * keep the two in step.
 *
 * Other websites cannot use it from the user's browser: the custom header
 * forces a CORS preflight, which this answers with an error.
 */
import { execSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';

let wslAddress;
/** The WSL2 virtual NIC, where a gateway inside WSL listening on 0.0.0.0 is reachable from Windows. */
const wsl = () => {
  if (wslAddress === undefined) {
    wslAddress = null;
    if (process.platform === 'win32') {
      try {
        wslAddress = execSync('wsl hostname -I', { encoding: 'utf8', timeout: 3000, windowsHide: true }).trim().split(/\s+/)[0] || null;
      } catch {
        wslAddress = null;
      }
    }
  }
  return wslAddress;
};

const fail = (res, status, message) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
};

/** Handles the request if it is for the proxy. Resolves to whether it was. */
export function handleLlmProxy(req, res) {
  if (!req.url?.startsWith('/llm-proxy')) return false;
  const target = req.headers['x-proxy-target'];
  if (!target || typeof target !== 'string') {
    fail(res, 400, 'Missing x-proxy-target header');
    return true;
  }
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    fail(res, 400, 'Invalid x-proxy-target URL');
    return true;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail(res, 400, 'x-proxy-target must be an http or https URL');
    return true;
  }

  const path = (parsed.pathname !== '/' ? parsed.pathname : '') + req.url.replace(/^\/llm-proxy/, '');
  // Everything but what only a browser sends, which gateways reject.
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || ['host', 'origin', 'referer', 'x-proxy-target'].includes(key.toLowerCase())) continue;
    headers[key] = value;
  }
  headers.host = parsed.host;
  const transport = parsed.protocol === 'https:' ? https : http;
  const port = parsed.port || (parsed.protocol === 'https:' ? 443 : 80);

  // Buffered, so a refused loopback connection can be retried against WSL.
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const send = (hostname, retried) => {
      const upstream = transport.request({ hostname, port, path, method: req.method, headers, servername: parsed.hostname }, (response) => {
        res.writeHead(response.statusCode || 502, response.headers);
        response.pipe(res);
      });
      upstream.on('error', (error) => {
        const loopback = hostname === '127.0.0.1' || hostname === 'localhost';
        const fallback = loopback && !retried && error.code === 'ECONNREFUSED' ? wsl() : null;
        if (fallback) return send(fallback, true);
        if (!res.headersSent) fail(res, 502, `Proxy error: ${error.message}`);
        else res.destroy(error);
      });
      upstream.end(body);
    };
    send(parsed.hostname, false);
  });
  return true;
}
