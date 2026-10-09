import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { cmdArgument, cmdCommand, createMcpPrograms, programEnv, resolveCommand } from '../src/mcp-programs.mjs';

/* A stdio MCP server in miniature: answers initialize with what it was started with, and lists one tool. */
const SERVER = `
const readline = require('node:readline');
process.stderr.write('stand-in server starting\\n');
console.log('not json: a server that logs to its output');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'stand-in', version: '1' }, argv: process.argv.slice(2), env: { token: process.env.WILLOW_COMPANION_TOKEN ?? null, key: process.env.STANDIN_KEY ?? null }, cwd: process.cwd() } }) + '\\n');
  } else if (message.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] } }) + '\\n');
  } else if (message.method === 'crash') {
    process.stderr.write('something went wrong\\n');
    process.exit(3);
  }
});
`;

const fixture = async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-programs-'));
  const script = path.join(folder, 'server.cjs');
  await fs.writeFile(script, SERVER);
  return { folder, script };
};

const harness = (options = {}) => {
  const events = [];
  const waiters = [];
  const send = (session, name, payload) => {
    events.push({ session: session.id, name, payload });
    for (const waiter of [...waiters]) if (waiter.test(name, payload)) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(payload);
    }
  };
  const programs = createMcpPrograms({ send, baseEnv: { ...process.env, WILLOW_COMPANION_TOKEN: 'secret-token' }, ...options });
  const next = (test, ms = 15_000) => new Promise((resolve, reject) => {
    const found = events.find((entry) => test(entry.name, entry.payload) && !entry.taken);
    if (found) {
      found.taken = true;
      resolve(found.payload);
      return;
    }
    const timer = setTimeout(() => reject(new Error('timed out waiting for an event')), ms);
    waiters.push({ test, resolve: (payload) => { clearTimeout(timer); events.find((entry) => entry.payload === payload).taken = true; resolve(payload); } });
  });
  return { programs, events, next };
};

it('escapes for cmd.exe as cross-spawn does: the file, and each argument quoted then escaped', () => {
  assert.equal(cmdCommand('C:\\Program Files\\nodejs\\npx.cmd'), 'C:\\Program^ Files\\nodejs\\npx.cmd');
  assert.equal(cmdArgument('C:\\Users\\Yashjit 2\\Docs'), '^"C:\\Users\\Yashjit^ 2\\Docs^"');
  assert.equal(cmdArgument('a&b|c'), '^"a^&b^|c^"');
  assert.equal(cmdArgument('say "hi"'), '^"say^ \\^"hi\\^"^"');
  assert.equal(cmdArgument('trailing\\'), '^"trailing\\\\^"', 'a trailing backslash is doubled so it does not escape the closing quote');
  assert.equal(cmdArgument('%PATH%', true), '^^^"^^^%PATH^^^%^^^"', 'an npm shim is escaped twice');
});

it('finds a launcher the way Windows does — PATHEXT in order, never the bare script beside it — and after the PATH, the usual places', () => {
  const files = new Set(['C:\\nodejs\\npx', 'C:\\nodejs\\npx.cmd', 'C:\\Users\\me\\.local\\bin\\uvx.exe', 'D:\\tools\\server.exe']);
  const exists = (file) => files.has(file);
  const env = { Path: 'C:\\Windows;"C:\\nodejs"', PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  assert.equal(resolveCommand('npx', { env, platform: 'win32', exists }), 'C:\\nodejs\\npx.cmd');
  assert.equal(resolveCommand('uvx', { env, platform: 'win32', exists }), null);
  assert.equal(resolveCommand('uvx', { env, platform: 'win32', exists, extra: ['C:\\Users\\me\\.local\\bin'] }), 'C:\\Users\\me\\.local\\bin\\uvx.exe');
  assert.equal(resolveCommand('D:\\tools\\server', { env, platform: 'win32', exists }), 'D:\\tools\\server.exe');
  assert.equal(resolveCommand('D:\\tools\\server.exe', { env, platform: 'win32', exists }), 'D:\\tools\\server.exe');
  assert.equal(resolveCommand('npx', { env: { PATH: '/usr/bin:/opt/homebrew/bin' }, platform: 'darwin', exists: (file) => file === '/opt/homebrew/bin/npx' }), '/opt/homebrew/bin/npx');
});

it('gives the program the companion\'s environment without its pairing token, the user\'s variables over it', () => {
  const env = programEnv({ Path: 'C:\\Windows', WILLOW_COMPANION_TOKEN: 'secret', WILLOW_COMPANION_PORT: '1', HOME: 'x' }, { PATH: 'C:\\mine', GITHUB_TOKEN: 'ghp', 'bad key': 'no', WILLOW_COMPANION_TOKEN: 'sneaky', NUM: 1 }, 'win32');
  assert.deepEqual(env, { HOME: 'x', PATH: 'C:\\mine', GITHUB_TOKEN: 'ghp' });
});

it('runs a server program: its messages come back, junk on its output does not, and stopping it ends it', async () => {
  const { folder, script } = await fixture();
  const { programs, events, next } = harness();
  const session = { id: 's1' };
  try {
    const started = await programs.handle(session, 'mcp.start', { id: 'stand-in.1', command: process.execPath, args: [script, 'a folder with spaces', 'x&y'], env: { STANDIN_KEY: 'k1' }, cwd: folder });
    assert.equal(started.id, 'stand-in.1');
    assert.ok(started.pid > 0);
    await programs.handle(session, 'mcp.send', { id: 'stand-in.1', message: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } });
    const hello = await next((name) => name === 'mcp.message');
    assert.equal(hello.id, 'stand-in.1');
    assert.deepEqual(hello.message.result.argv, ['a folder with spaces', 'x&y']);
    assert.deepEqual(hello.message.result.env, { token: null, key: 'k1' }, 'the pairing token never reaches the program');
    assert.equal(await fs.realpath(hello.message.result.cwd), await fs.realpath(folder));
    await programs.handle(session, 'mcp.send', { id: 'stand-in.1', message: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
    const tools = await next((name) => name === 'mcp.message');
    assert.equal(tools.message.result.tools[0].name, 'echo');
    assert.ok(events.every((entry) => entry.session === 's1'), 'only the window that started it hears it');
    assert.ok(!events.some((entry) => JSON.stringify(entry.payload).includes('not json')));

    await programs.handle(session, 'mcp.stop', { id: 'stand-in.1' });
    const exit = await next((name) => name === 'mcp.exit');
    assert.match(exit.stderr, /stand-in server starting/);
    await assert.rejects(programs.handle(session, 'mcp.send', { id: 'stand-in.1', message: { jsonrpc: '2.0', id: 3, method: 'ping' } }), /has stopped/);
  } finally {
    programs.dispose();
    await fs.rm(folder, { recursive: true, force: true });
  }
});

it('reports a program that dies with what it printed, and a launcher that is not installed with where it comes from', async () => {
  const { folder, script } = await fixture();
  const { programs, next } = harness({ resolve: (command, options) => (command === 'npx' ? null : resolveCommand(command, options)) });
  const session = { id: 's2' };
  try {
    await programs.handle(session, 'mcp.start', { id: 'crashy', command: process.execPath, args: [script] });
    await programs.handle(session, 'mcp.send', { id: 'crashy', message: { jsonrpc: '2.0', id: 1, method: 'crash' } });
    const exit = await next((name) => name === 'mcp.exit');
    assert.equal(exit.code, 3);
    assert.match(exit.stderr, /something went wrong/);
    assert.match(exit.stderr, /not json: a server that logs to its output/, 'what it wrongly printed to its output is kept for the reason');

    await assert.rejects(programs.handle(session, 'mcp.start', { id: 'missing', command: 'npx', args: ['-y', 'x'] }), /could not find npx on this computer\. It comes with Node\.js/);
    await assert.rejects(programs.handle(session, 'mcp.start', { id: 'missing', command: 'no-such-tool-xyz' }), /could not find no-such-tool-xyz/);
    await assert.rejects(programs.handle(session, 'mcp.start', { id: 'bad id!', command: process.execPath }), /needs an id/);
    await assert.rejects(programs.handle(session, 'mcp.start', { id: 'nowhere', command: process.execPath, cwd: path.join(folder, 'missing') }), /There is no folder/);
  } finally {
    programs.dispose();
    await fs.rm(folder, { recursive: true, force: true });
  }
});

it('runs a .cmd launcher through cmd.exe with its arguments intact', { skip: process.platform !== 'win32' }, async () => {
  const { folder, script } = await fixture();
  const launcher = path.join(folder, 'launch server.cmd');
  await fs.writeFile(launcher, `@"${process.execPath}" "${script}" %*\r\n`);
  const { programs, next } = harness();
  const session = { id: 's3' };
  try {
    await programs.handle(session, 'mcp.start', { id: 'shim', command: launcher, args: ['C:\\Users\\Yashjit 2\\Docs', 'a&b|c', '100%', 'say "hi"', '(x)'] });
    await programs.handle(session, 'mcp.send', { id: 'shim', message: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } });
    const hello = await next((name) => name === 'mcp.message');
    assert.deepEqual(hello.message.result.argv, ['C:\\Users\\Yashjit 2\\Docs', 'a&b|c', '100%', 'say "hi"', '(x)']);
    programs.release(session);
    const exit = await next((name) => name === 'mcp.exit');
    assert.equal(exit.id, 'shim');
  } finally {
    programs.dispose();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
