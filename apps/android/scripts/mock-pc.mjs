// A stand-in for the PC's two servers, to try the app without Willow:
//
//   node apps/android/scripts/mock-pc.mjs [--host 127.0.0.1] [--agents 47100] [--willow 47101]
//
// Pair with http://<host>:<agents>/pair#token=anything (an emulator reaches the host's
// 127.0.0.1 as 10.0.2.2). The agents' side answers /.well-known/willow/mobile and pairs
// like T3 Code: an HttpOnly session cookie, then '/'. Willow's side is one test page: the
// bridge, the cookie across ports, Server-Sent Events, a WebSocket, and buttons for the tools.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const option = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : fallback;
};
const host = option('host', '127.0.0.1');
const agentsPort = Number(option('agents', '47100'));
const willowPort = Number(option('willow', '47101'));
const SESSION = 'mock_session';

const agents = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  log('agents', request);
  if (url.pathname === '/.well-known/willow/mobile') {
    return send(response, 200, 'application/json', JSON.stringify({ version: 1, willowPort }));
  }
  if (url.pathname === '/api/pair') {
    response.setHeader('Set-Cookie', `${SESSION}=${encodeURIComponent(url.searchParams.get('token') ?? '')}; Path=/; HttpOnly; SameSite=Lax`);
    return send(response, 200, 'application/json', '{"paired":true}');
  }
  if (url.pathname === '/pair') {
    return send(response, 200, 'text/html', page('Pairing…', `<p>Pairing…</p><script>
      var token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
      fetch('/api/pair?token=' + encodeURIComponent(token)).then(function () { location.replace('/'); });
    </script>`));
  }
  return send(response, 200, 'text/html', page('Agents (mock)', `<p>Agents (mock). Session: ${hasSession(request)}</p>`));
});

const willow = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  log('willow', request);
  if (url.pathname === '/events') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    let tick = 0;
    const timer = setInterval(() => response.write(`data: tick ${++tick}\n\n`), 1000);
    request.on('close', () => clearInterval(timer));
    return;
  }
  if (url.pathname !== '/') return send(response, 404, 'text/plain', 'Not found');
  return send(response, 200, 'text/html', page('Willow (mock)', `
    <h1>Willow (mock)</h1>
    <p>Session cookie from the agents' origin: <b>${hasSession(request)}</b></p>
    <p>Bridge: <b id="bridge">…</b></p>
    <p>SSE: <b id="sse">…</b> · WebSocket: <b id="ws">…</b></p>
    <p>phone_status: <code id="status">…</code></p>
    <p><button onclick="call('phone_vibrate', {pattern: 'success'})">Vibrate</button>
       <button onclick="call('phone_notify', {title: 'Willow (mock)', body: 'From the PC'})">Notify</button>
       <button onclick="call('phone_location', {})">Location</button>
       <button onclick="call('phone_photo', {maxSize: 512})">Photo</button>
       <button onclick="window.__WILLOW_ANDROID__.post({kind: 'open-settings'})">Settings</button>
       <a href="https://example.com/" target="_blank">example.com</a></p>
    <pre id="log"></pre>
    <script>
      var bridge = window.__WILLOW_ANDROID__;
      var pending = {};
      var next = 0;
      function show(id, text) { document.getElementById(id).textContent = text; }
      function out(text) { document.getElementById('log').textContent = text + '\\n' + document.getElementById('log').textContent; }
      function call(tool, args) {
        var id = 'c' + (++next);
        return new Promise(function (resolve, reject) {
          pending[id] = { resolve: resolve, reject: reject };
          bridge.post({ kind: 'phone-call', id: id, tool: tool, args: args });
        }).then(function (result) { out(tool + ' ok ' + JSON.stringify(result).slice(0, 200)); return result; },
                function (error) { out(tool + ' failed: ' + error.message); throw error; });
      }
      if (!bridge) {
        show('bridge', 'missing');
      } else {
        show('bridge', 'v' + bridge.version + ', ' + bridge.agentsOrigin + ', tools: ' + bridge.tools.join(' '));
        bridge.listeners.push(function (message) {
          if (message.kind === 'tools-changed') return out('tools-changed: ' + message.tools.join(' '));
          var entry = message.kind === 'phone-result' && pending[message.id];
          if (!entry) return;
          delete pending[message.id];
          message.ok ? entry.resolve(message.result) : entry.reject(new Error(message.error));
        });
        call('phone_status', {}).then(function (status) { show('status', JSON.stringify(status)); },
                                      function (error) { show('status', 'error: ' + error.message); });
      }
      new EventSource('/events').onmessage = function (event) { show('sse', event.data); };
      var socket = new WebSocket('ws://' + location.host + '/socket');
      socket.onmessage = function (event) { show('ws', event.data); };
      socket.onerror = function () { show('ws', 'error'); };
    </script>`));
});

// The smallest WebSocket: the handshake, then one text frame.
willow.on('upgrade', (request, socket) => {
  log('willow', request);
  const key = request.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const text = Buffer.from('hello over the tunnel');
  socket.write(Buffer.concat([Buffer.from([0x81, text.length]), text]));
  socket.on('data', () => {});
  socket.on('error', () => {});
});

agents.listen(agentsPort, host, () => console.log(`agents (mock) on http://${host}:${agentsPort}`));
willow.listen(willowPort, host, () => console.log(`willow (mock) on http://${host}:${willowPort}`));

function hasSession(request) {
  return (request.headers.cookie ?? '').split(/;\s*/).some((pair) => pair.startsWith(`${SESSION}=`)) ? 'yes' : 'no';
}

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><style>body{font:16px system-ui;margin:24px;background:#0f0f0f;color:#fff}code,pre{white-space:pre-wrap;word-break:break-all;color:#8bc26b}button{font:inherit;margin:4px}a{color:#8bc26b}</style>
</head><body>${body}</body></html>`;
}

function send(response, status, type, body) {
  response.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
  response.end(body);
}

function log(server, request) {
  console.log(`${new Date().toISOString().slice(11, 19)} ${server} ${request.method} ${request.url}`);
}
