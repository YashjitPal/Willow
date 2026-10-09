/**
 * Which tab is not answering CDP? Sends one Runtime.evaluate to every page target with
 * a 5s timeout. A page held by a JavaScript dialog (alert / confirm / beforeunload)
 * never answers, which makes puppeteer.connect() hang on Network.enable.
 *
 *   node tools/scratch/cdp-probe.cjs            report only
 *   node tools/scratch/cdp-probe.cjs --dismiss  also dismiss (cancel) an open dialog
 */
const http = require('http');
const WebSocket = require('ws');

const HOST = process.env.SPARK_CDP_URL || 'http://[::1]:9222';
const dismiss = process.argv.includes('--dismiss');

const get = (p) => new Promise((resolve, reject) => {
  http.get(HOST + p, (r) => {
    let d = '';
    r.on('data', (c) => { d += c; });
    r.on('end', () => resolve(d));
  }).on('error', reject);
});

const send = (ws, id, method, params = {}) => ws.send(JSON.stringify({ id, method, params }));

const probe = (target) => new Promise((resolve) => {
  const url = target.webSocketDebuggerUrl.replace(/ws:\/\/(localhost|127\.0\.0\.1)/, 'ws://[::1]');
  const ws = new WebSocket(url);
  const finish = (value) => {
    clearTimeout(timer);
    try { ws.close(); } catch { /* already closed */ }
    resolve(value);
  };
  const timer = setTimeout(() => {
    if (!dismiss) return finish('NO RESPONSE in 5s');
    // Page.handleJavaScriptDialog is answered by the browser, not the blocked renderer.
    send(ws, 2, 'Page.handleJavaScriptDialog', { accept: false });
    setTimeout(() => finish('NO RESPONSE in 5s; sent dialog dismiss'), 1500);
  }, 5000);
  ws.on('open', () => send(ws, 1, 'Runtime.evaluate', {
    expression: 'document.visibilityState + " " + document.readyState',
  }));
  ws.on('message', (m) => {
    const j = JSON.parse(m);
    if (j.id === 1) finish(JSON.stringify(j.result?.result?.value ?? j.error));
    if (j.id === 2) console.log('   dismiss reply:', JSON.stringify(j.error ?? j.result));
  });
  ws.on('error', (e) => finish(`ws error ${e.message}`));
});

(async () => {
  const pages = JSON.parse(await get('/json/list')).filter((t) => t.type === 'page');
  for (const t of pages) {
    console.log(t.id.slice(0, 8), t.url.slice(0, 70), '=>', await probe(t));
  }
})();
