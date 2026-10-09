/**
 * Drives `api/_browse-proxy.js` on a throwaway local server, against live public
 * pages: page fetch + bridge injection, redirect and cookie rewriting, the raw
 * endpoint, html2canvas, and the private-address guard.
 *
 *   node tools/scratch/browse-proxy-smoke.mjs
 */
import http from 'node:http';
import { encodeOrigin, decodeOrigin, handleBrowseRequest, toBrowseUrl } from '../../api/_browse-proxy.js';

const server = http.createServer(async (req, res) => {
  const handled = await handleBrowseRequest(req, res, { enabled: true });
  if (!handled) {
    res.statusCode = 404;
    res.end('not a browse host');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const get = (target, path = null, headers = {}) => new Promise((resolve, reject) => {
  const url = new URL(toBrowseUrl(target, port));
  const request = http.request({
    host: '127.0.0.1',
    port,
    path: path ?? `${url.pathname}${url.search}`,
    method: 'GET',
    headers: { host: url.host, accept: 'text/html,*/*', 'sec-fetch-dest': 'iframe', ...headers },
  }, (response) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
  });
  request.on('error', reject);
  request.end();
});

const check = (label, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);

for (const origin of ['https://www.wolframalpha.com', 'http://example.com:8080', 'https://a-very-long-subdomain-name.with-several-labels.example.co.uk']) {
  const encoded = encodeOrigin(origin);
  check(`round trip ${origin}`, decodeOrigin(encoded) === origin, encoded);
}

const page = await get('https://example.com/');
const html = page.body.toString('utf8');
check('example.com 200', page.status === 200, String(page.status));
check('bridge injected into <head>', /<head[^>]*><script data-willow-browse>/i.test(html));
check('config filled', html.includes('"origin":"https://example.com"'));
check('no CSP header', !page.headers['content-security-policy']);

const redirect = await get('http://wikipedia.org/');
check('redirect rewritten onto the proxy', /\.wb\.localhost:\d+\//.test(String(redirect.headers.location || '')), `${redirect.status} ${redirect.headers.location}`);

const raw = await get('https://example.com/', `/__willow_browse__/raw?url=${encodeURIComponent('https://www.google.com/favicon.ico')}`, { accept: 'image/*' });
check('raw image', raw.status === 200 && /image/.test(String(raw.headers['content-type'])), `${raw.status} ${raw.headers['content-type']} ${raw.body.length}b cors=${raw.headers['access-control-allow-origin']}`);

const h2c = await get('https://example.com/', '/__willow_browse__/html2canvas.js', { accept: '*/*' });
check('html2canvas served', h2c.status === 200 && h2c.body.length > 100_000, `${h2c.status} ${h2c.body.length}b`);

const loopback = await get('http://127.0.0.1/');
check('loopback refused', loopback.status === 403, String(loopback.status));
const rebind = await get('http://localtest.me/');
check('public name resolving to loopback refused', rebind.status === 403 || rebind.status === 502, `${rebind.status} ${rebind.body.toString('utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90)}`);

const ddg = await get('https://html.duckduckgo.com/html/?q=alan+turing');
const ddgHtml = ddg.body.toString('utf8');
check('duckduckgo html search', ddg.status === 200 && /result__a/.test(ddgHtml), `${ddg.status} ${ddgHtml.length}b`);

server.close();
