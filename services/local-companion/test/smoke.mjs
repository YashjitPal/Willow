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
  const quoted = await call(socket, 'shell.exec', { workspaceId: workspace.workspaceId, command: 'node -e "console.log(\'quoted\', 1 + 1)"' });
  assert.equal(quoted.code, 0, quoted.stderr);
  assert.match(quoted.stdout, /quoted 2/);

  const finished = async (jobId) => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const job = await call(socket, 'job.read', { jobId });
      if (!job.running) return job;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Background job did not finish.');
  };
  const quick = await call(socket, 'job.start', { workspaceId: workspace.workspaceId, command: 'node -e "console.log(\'job output\')"' });
  assert.equal(quick.running, true);
  const quickDone = await finished(quick.jobId);
  assert.equal(quickDone.code, 0);
  assert.match(quickDone.text, /job output/);
  const slow = await call(socket, 'job.start', { workspaceId: workspace.workspaceId, command: 'node -e "setInterval(() => {}, 1000)"' });
  await call(socket, 'job.stop', { jobId: slow.jobId });
  assert.equal((await finished(slow.jobId)).signal, 'STOPPED');
  assert.ok((await call(socket, 'job.list')).jobs.some((job) => job.jobId === quick.jobId));
  await assert.rejects(call(socket, 'job.start', { workspaceId: workspace.workspaceId, command: 'node --version', cwd: '..' }), /outside the authorised workspace/);

  const listing = await call(socket, 'fs.list', { workspaceId: workspace.workspaceId });
  assert.ok(listing.entries.some((entry) => entry.path === 'src' && entry.type === 'dir'));
  assert.ok(listing.entries.some((entry) => entry.path === 'package.json' && entry.type === 'file'));
  const manifest = await call(socket, 'fs.read', { workspaceId: workspace.workspaceId, path: 'package.json' });
  assert.equal(manifest.binary, false);
  assert.match(manifest.text, /"name"/);
  const found = await call(socket, 'fs.search', { workspaceId: workspace.workspaceId, query: 'willow-local-companion' });
  assert.ok(found.matches.some((match) => match.path === 'src/index.mjs' && match.line > 0));
  await assert.rejects(call(socket, 'fs.read', { workspaceId: workspace.workspaceId, path: '../package.json' }), /outside the authorised workspace/);
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
