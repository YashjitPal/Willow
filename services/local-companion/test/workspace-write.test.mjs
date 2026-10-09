import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, it } from 'node:test';
import { WebSocket } from 'ws';

const port = 43231;
let child;
let socket;
let folder;
let workspaceId;

const call = (type, payload = {}) => new Promise((resolve, reject) => {
  const id = `write-${Date.now()}-${Math.random()}`;
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

before(async () => {
  folder = await mkdtemp(path.join(tmpdir(), 'willow-write-'));
  child = spawn(process.execPath, ['src/index.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, WILLOW_COMPANION_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break;
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  ({ workspaceId } = await call('workspace.authorize', { root: folder }));
});

after(async () => {
  socket?.close();
  child?.kill();
  if (folder) await rm(folder, { recursive: true, force: true });
});

it('writes files inside the authorised folder, making folders as needed, and nowhere else', async () => {
  const written = await call('fs.write', { workspaceId, path: 'src/new/app.ts', text: 'export const a = 1;\n' });
  assert.equal(written.path, 'src/new/app.ts');
  assert.equal(written.created, true);
  assert.equal(await readFile(path.join(folder, 'src', 'new', 'app.ts'), 'utf8'), 'export const a = 1;\n');
  const read = await call('fs.read', { workspaceId, path: 'src/new/app.ts' });
  assert.equal(read.text, 'export const a = 1;\n');

  const replaced = await call('fs.write', { workspaceId, path: 'src/new/app.ts', text: 'export const a = 2;\n', expectModifiedAt: read.modifiedAt });
  assert.equal(replaced.created, false);
  assert.equal(await readFile(path.join(folder, 'src', 'new', 'app.ts'), 'utf8'), 'export const a = 2;\n');

  await assert.rejects(call('fs.write', { workspaceId, path: '../escape.txt', text: 'x' }), /outside the authorised workspace/);
  await assert.rejects(call('fs.write', { workspaceId, path: '.', text: 'x' }), /outside the authorised workspace/);
  await assert.rejects(call('fs.write', { workspaceId, path: 'src', text: 'x' }), /a folder, not a file/);
});

it('relays Telegram for a bot token and four methods only, never as a general proxy', async () => {
  await assert.rejects(call('relay.telegram', { token: 'not-a-token', method: 'getMe' }), /not a Telegram bot token/);
  await assert.rejects(call('relay.telegram', { token: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ', method: 'deleteWebhook' }), /not allowed/);
  await assert.rejects(call('relay.telegram', { token: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ', method: '../../evil' }), /not allowed/);
  const tools = await call('tool.list');
  assert.ok(tools.tools.includes('relay.telegram'));
  assert.ok(tools.tools.includes('fs.write'));
});

it('types into a running job, which reads it as its input', async () => {
  const job = await call('job.start', { workspaceId, command: 'node -e "process.stdin.on(\'data\', (d) => console.log(\'got \' + d.toString().trim()))"' });
  const written = await call('job.write', { jobId: job.jobId, text: 'hello\n' });
  assert.equal(written.written, 6);
  const deadline = Date.now() + 10_000;
  let output = '';
  while (Date.now() < deadline && !output.includes('got hello')) {
    output = (await call('job.read', { jobId: job.jobId })).text;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.match(output, /got hello/);
  await call('job.write', { jobId: job.jobId, text: '', close: true });
  await call('job.stop', { jobId: job.jobId });
  await assert.rejects(call('job.write', { jobId: 'job-nope', text: 'x' }), /No such job/);
});

it('relays an MCP server\'s https to public addresses only, never to this computer or its network', async () => {
  await assert.rejects(call('relay.http', { url: 'http://example.com/mcp', method: 'POST', body: '{}' }), /Only https/);
  await assert.rejects(call('relay.http', { url: 'https://localhost/mcp', method: 'POST', body: '{}' }), /this computer or its network/);
  await assert.rejects(call('relay.http', { url: 'https://127.0.0.1/mcp', method: 'POST', body: '{}' }), /this computer or its network/);
  await assert.rejects(call('relay.http', { url: 'https://192.168.1.10/mcp', method: 'POST', body: '{}' }), /this computer or its network/);
  await assert.rejects(call('relay.http', { url: 'not a url' }), /not a web address/);
  assert.ok((await call('tool.list')).tools.includes('relay.http'));
});

it('copies a file\'s bytes as they are, in pieces, for a bot\'s own computer', async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a, 0x00, 0xff, 0x10]);
  await call('fs.write', { workspaceId, path: 'out/picture.png', encoding: 'base64', data: bytes.subarray(0, 6).toString('base64') });
  await call('fs.write', { workspaceId, path: 'out/picture.png', encoding: 'base64', data: bytes.subarray(6).toString('base64'), append: true });
  assert.deepEqual(await readFile(path.join(folder, 'out', 'picture.png')), bytes, 'a binary file goes in whole, zero bytes and all');
  const first = await call('fs.read', { workspaceId, path: 'out/picture.png', encoding: 'base64', limit: 4 });
  assert.equal(first.data, bytes.subarray(0, 4).toString('base64'));
  assert.equal(first.next, 4);
  const rest = await call('fs.read', { workspaceId, path: 'out/picture.png', encoding: 'base64', offset: first.next });
  assert.equal(Buffer.from(rest.data, 'base64').length, bytes.length - 4);
  assert.equal(rest.next, null);
  assert.equal((await call('fs.read', { workspaceId, path: 'out/picture.png' })).binary, true, 'read as text, it is still binary');
});

it('leaves a file alone when it changed since it was read', async () => {
  await writeFile(path.join(folder, 'notes.md'), 'first\n');
  const read = await call('fs.read', { workspaceId, path: 'notes.md' });
  const later = new Date(Date.now() + 60_000);
  await utimes(path.join(folder, 'notes.md'), later, later);
  await assert.rejects(call('fs.write', { workspaceId, path: 'notes.md', text: 'second\n', expectModifiedAt: read.modifiedAt }), /changed since it was read/);
  assert.equal(await readFile(path.join(folder, 'notes.md'), 'utf8'), 'first\n');
});
