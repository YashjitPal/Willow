import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const port = 43118;
const child = spawn(process.execPath, ['src/index.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, WILLOW_COMPANION_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const waitForHealth = async () => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return response.json();
    } catch {
      // The child may still be starting Chromium dependencies.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Companion health endpoint did not become ready.');
};

const call = (socket, type, payload = {}) => new Promise((resolve, reject) => {
  const id = `smoke-${Date.now()}-${Math.random()}`;
  const timer = setTimeout(() => reject(new Error(`Timed out: ${type}`)), 20_000);
  const onMessage = (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.id !== id) return;
    clearTimeout(timer);
    socket.off('message', onMessage);
    if (message.ok) resolve(message.result);
    else reject(new Error(message.error));
  };
  socket.on('message', onMessage);
  socket.send(JSON.stringify({ id, type, payload }));
});

try {
  const health = await waitForHealth();
  assert.equal(health.ok, true);
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Companion ready event timed out.')), 5_000);
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== 'ready') return;
      clearTimeout(timer);
      resolve(message);
    });
  });
  assert.equal(ready.type, 'ready');
  const tools = await call(socket, 'tool.list');
  assert.ok(tools.tools.includes('shell.exec'));
  assert.ok(tools.tools.includes('browser.launch'));
  const workspace = await call(socket, 'workspace.authorize', { root: process.cwd() });
  const shell = await call(socket, 'shell.exec', { workspaceId: workspace.workspaceId, command: 'node --version' });
  assert.equal(shell.code, 0);
  assert.match(shell.stdout, /^v\d+/);
  const browser = await call(socket, 'browser.launch', { url: 'about:blank' });
  assert.ok(browser.frame.dataUrl.startsWith('data:image/png;base64,'));
  assert.ok(browser.tabs.length >= 1);
  const closed = await call(socket, 'browser.close', { sessionId: ready.sessionId });
  assert.equal(closed.closed, true);
  assert.deepEqual(closed.tabs, []);
  socket.close();
  console.log('local companion smoke test passed');
} finally {
  child.kill();
}
