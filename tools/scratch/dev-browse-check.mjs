import http from 'node:http';
import { toBrowseUrl } from '../../api/_browse-proxy.js';
const url = new URL(toBrowseUrl('https://example.com/', 3000));
for (const host of ['localhost', '127.0.0.1', '::1']) {
  await new Promise((resolve) => {
    const req = http.request({ host, port: 3000, path: url.pathname, headers: { host: url.host, accept: 'text/html', 'sec-fetch-dest': 'iframe' } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { console.log(host, res.statusCode, res.headers['content-type'], body.includes('data-willow-browse') ? 'bridge injected' : body.slice(0, 120)); resolve(); });
    });
    req.on('error', (e) => { console.log(host, 'error', e.message); resolve(); });
    req.end();
  });
}
