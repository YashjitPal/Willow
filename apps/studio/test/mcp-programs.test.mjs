import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const store = await importTs(path.join(repoRoot, 'platform', 'ai', 'src', 'mcp', 'mcp-store.ts'));
const input = await importTs(path.join(repoRoot, 'features', 'spark', 'src', 'mcp-program-input.ts'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (test, ms = 3_000) => {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error('timed out');
    await sleep(5);
  }
};

/* The companion as the window sees it: programs started, stopped, and answering — or not. */
const fakeHost = () => {
  const listeners = new Map();
  const started = [];
  const stopped = [];
  let mode = 'ok';
  const host = {
    start: async (id, spec) => {
      started.push({ id, spec });
      if (mode === 'missing') throw new Error('Willow could not find npx on this computer. It comes with Node.js (nodejs.org): install that, then turn the server on again.');
    },
    send: async (id, message) => {
      const on = listeners.get(id);
      if (mode === 'dies' && message.method === 'initialize') {
        setTimeout(() => on.exit({ code: 1, signal: null, stderr: 'Error: Cannot find module "@example/server"' }), 5);
        return;
      }
      if (message.method === 'initialize') setTimeout(() => on.message({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'memory', version: '1' } } }), 1);
      if (message.method === 'tools/list') setTimeout(() => on.message({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'create_entities', inputSchema: { type: 'object' } }] } }), 1);
    },
    stop: async (id) => {
      stopped.push(id);
    },
    listen: (id, on) => {
      listeners.set(id, on);
      return () => listeners.delete(id);
    },
  };
  return { host, started, stopped, listeners, mode: (next) => { mode = next; } };
};

it('splits a command as typed — quotes keep words together, backslashes stay — and reads variables', () => {
  assert.deepEqual(input.splitCommand('npx -y @modelcontextprotocol/server-filesystem "C:\\Users\\Yashjit 2\\Docs" D:\\notes'), ['npx', '-y', '@modelcontextprotocol/server-filesystem', 'C:\\Users\\Yashjit 2\\Docs', 'D:\\notes']);
  assert.deepEqual(input.splitCommand("  uvx  mcp-server-git --repository='/home/me/my repo' "), ['uvx', 'mcp-server-git', '--repository=/home/me/my repo']);
  assert.deepEqual(input.splitCommand('tool ""'), ['tool', ''], 'an empty quoted argument is still an argument');
  assert.deepEqual(input.splitCommand('npx "unclosed'), { problem: 'A quote in the command is not closed.' });
  assert.deepEqual(input.splitCommand('   '), { problem: 'Enter the command that starts the server.' });
  assert.deepEqual(input.parseEnvLines('# keys\nGITHUB_TOKEN=ghp_1\nexport REGION = "eu"\n\nproblem=fine'), { env: { GITHUB_TOKEN: 'ghp_1', REGION: 'eu', problem: 'fine' } });
  assert.deepEqual(input.parseEnvLines('NOT A VAR'), { problem: 'Line 1 should be NAME=value.' });
  assert.equal(input.commandLine('npx', ['-y', 'server', 'C:\\My Docs']), 'npx -y server "C:\\My Docs"');
});

it('connects a program server through the companion, its tools named like any other, and stops it when turned off', async () => {
  const fake = fakeHost();
  store.setMcpProgramHost(fake.host);
  try {
    store.upsertMcpServer({ id: 'memory', label: 'Memory', kind: 'program', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], env: { MEMORY_FILE_PATH: 'C:\\m.json' }, enabled: true });
    await store.connectMcpServer('memory');
    const status = store.mcpRuntime.get().memory.status;
    assert.equal(status.state, 'ready');
    assert.equal(status.serverName, 'memory');
    assert.deepEqual(fake.started[0].spec, { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], env: { MEMORY_FILE_PATH: 'C:\\m.json' } });
    assert.match(fake.started[0].id, /^memory\./, 'each connection is a program of its own');
    assert.ok(store.boundMcpTools().some((tool) => tool.qualifiedName === 'mcp__memory__create_entities'));

    await store.setMcpServerEnabled('memory', false);
    assert.deepEqual(fake.stopped, [fake.started[0].id]);
  } finally {
    await store.removeMcpServer('memory');
    store.setMcpProgramHost(undefined);
  }
});

it('says why a program failed — not installed, or died with what it printed — at once rather than at a timeout', async () => {
  const fake = fakeHost();
  store.upsertMcpServer({ id: 'nohost', label: 'No host', kind: 'program', command: 'npx', args: [], enabled: true });
  await store.connectMcpServer('nohost');
  assert.match(store.mcpRuntime.get().nohost.status.message, /desktop app/);
  await store.removeMcpServer('nohost');

  store.setMcpProgramHost(fake.host);
  try {
    fake.mode('missing');
    store.upsertMcpServer({ id: 'missing', label: 'Missing', kind: 'program', command: 'npx', args: ['-y', 'x'], enabled: true });
    await store.connectMcpServer('missing');
    const missing = store.mcpRuntime.get().missing.status;
    assert.equal(missing.state, 'failed');
    assert.equal(missing.kind, 'program-failed');
    assert.match(missing.message, /could not find npx on this computer/);

    fake.mode('dies');
    store.upsertMcpServer({ id: 'dies', label: 'Example', kind: 'program', command: 'npx', args: ['-y', '@example/server'], enabled: true });
    const began = Date.now();
    await store.connectMcpServer('dies');
    const died = store.mcpRuntime.get().dies.status;
    assert.ok(Date.now() - began < 2_000, 'the waiting handshake fails with the exit, not after a minute');
    assert.equal(died.message, 'Example stopped (exit code 1).');
    assert.match(died.detail, /Cannot find module/);
  } finally {
    await store.removeMcpServer('missing');
    await store.removeMcpServer('dies');
    store.setMcpProgramHost(undefined);
  }
});

it('gives a handshake the time its transport asks for, as a program fetched on its first start needs', async () => {
  const { McpClient } = await importTs(path.join(repoRoot, 'platform', 'ai', 'src', 'mcp', 'mcp-client.ts'));
  const { createProgramTransport } = await importTs(path.join(repoRoot, 'platform', 'ai', 'src', 'mcp', 'program-transport.ts'));
  assert.equal(createProgramTransport({ id: 'x', label: 'X', spec: { command: 'npx', args: [] }, host: fakeHost().host }).handshakeTimeoutMs, 300_000);
  const silent = { send: async () => {}, onMessage: () => {}, close: async () => {}, handshakeTimeoutMs: 40 };
  await assert.rejects(McpClient.connect('slow', silent), (error) => error.kind === 'timeout' && /within 0\.04 seconds/.test(error.message));
});

it('starts a program again once when it ends on its own, and leaves one that keeps ending failed', async () => {
  const fake = fakeHost();
  store.setMcpProgramHost(fake.host);
  try {
    store.upsertMcpServer({ id: 'flaky', label: 'Flaky', kind: 'program', command: 'node', args: ['server.js'], enabled: true });
    await store.connectMcpServer('flaky');
    assert.equal(store.mcpRuntime.get().flaky.status.state, 'ready');

    fake.listeners.get(fake.started[0].id).exit({ code: null, signal: 'SIGKILL', stderr: '' });
    await until(() => fake.started.length === 2 && store.mcpRuntime.get().flaky.status.state === 'ready');
    assert.notEqual(fake.started[1].id, fake.started[0].id);

    fake.listeners.get(fake.started[1].id).exit({ code: 2, signal: null, stderr: 'out of memory' });
    await until(() => store.mcpRuntime.get().flaky.status.state === 'failed');
    await sleep(50);
    assert.equal(fake.started.length, 2, 'not started a second time within the minute');
    assert.deepEqual(store.mcpRuntime.get().flaky.status, { state: 'failed', message: 'Flaky stopped (exit code 2).', detail: 'out of memory', kind: 'program-failed' });
    assert.ok(!store.boundMcpTools().some((tool) => tool.qualifiedName.startsWith('mcp__flaky__')), 'its tools go with it');
  } finally {
    await store.removeMcpServer('flaky');
    store.setMcpProgramHost(undefined);
  }
});
