/**
 * Where is a hung tab stuck? Interrupts its main thread through the debugger (V8 handles
 * Debugger.pause as an interrupt, so it works mid-loop), prints the call stack, resumes.
 *
 *   node tools/scratch/cdp-pause-stack.cjs localhost:3000
 */
const http = require('http');
const WebSocket = require('ws');

const HOST = process.env.SPARK_CDP_URL || 'http://[::1]:9222';
const match = process.argv[2] || 'localhost:3000';

const get = (p) => new Promise((resolve, reject) => {
  http.get(HOST + p, (r) => {
    let d = '';
    r.on('data', (c) => { d += c; });
    r.on('end', () => resolve(d));
  }).on('error', reject);
});

(async () => {
  const target = JSON.parse(await get('/json/list')).find((t) => t.type === 'page' && t.url.includes(match));
  if (!target) throw new Error(`no page matching ${match}`);
  const ws = new WebSocket(target.webSocketDebuggerUrl.replace(/ws:\/\/(localhost|127\.0\.0\.1)/, 'ws://[::1]'));
  let id = 0;
  const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
  const done = (code) => { try { ws.close(); } catch { /* closed */ } process.exit(code); };
  const timer = setTimeout(() => { console.log('no Debugger.paused within 10s'); done(1); }, 10000);

  ws.on('open', () => {
    send('Debugger.enable');
    send('Debugger.pause');
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.error) console.log('error', msg.id, msg.error.message);
    if (msg.method !== 'Debugger.paused') return;
    clearTimeout(timer);
    console.log('paused, reason:', msg.params.reason);
    for (const frame of msg.params.callFrames.slice(0, 14)) {
      const url = (frame.url || '').replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '');
      console.log(`  ${frame.functionName || '(anonymous)'}  ${url}:${frame.location.lineNumber + 1}:${frame.location.columnNumber + 1}`);
    }
    send('Debugger.resume');
    send('Debugger.disable');
    setTimeout(() => done(0), 500);
  });
  ws.on('error', (e) => { console.log('ws error', e.message); done(1); });
})();
