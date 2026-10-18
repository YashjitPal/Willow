import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { createMcpPrograms, resolveCommand } from '../src/mcp-programs.mjs';

/*
 * X Reader (src/mcp-servers/x-reader.py), started as the desktop app starts it: by name, through uv. With cookies no
 * session has, it answers the handshake and lists its tools without asking x.com anything; the network is needed
 * once, while uv fetches the twscrape it pins. Skipped where uv is not installed.
 */
const uv = resolveCommand('uv', { extra: [path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.cargo', 'bin')] });
const skip = uv ? false : 'uv is not installed';
const COOKIES = 'auth_token=0123456789abcdef0123456789abcdef01234567; ct0=0123456789abcdef0123456789abcdef';

const harness = () => {
  const events = [];
  const waiters = [];
  const send = (session, name, payload) => {
    const entry = { name, payload };
    const waiter = waiters.find((candidate) => candidate.test(name, payload));
    if (waiter) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(payload);
    } else events.push(entry);
  };
  const programs = createMcpPrograms({ send });
  const next = (test, ms = 240_000) => new Promise((resolve, reject) => {
    const found = events.findIndex((entry) => test(entry.name, entry.payload));
    if (found !== -1) {
      resolve(events.splice(found, 1)[0].payload);
      return;
    }
    const timer = setTimeout(() => reject(new Error('timed out waiting for X Reader')), ms);
    waiters.push({ test, resolve: (payload) => { clearTimeout(timer); resolve(payload); } });
  });
  const session = { id: 'x-reader-test' };
  const ask = async (id, method, params) => {
    await programs.handle(session, 'mcp.send', { id: 'x-reader', message: { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) } });
    return (await next((name, payload) => name === 'mcp.message' && payload.message.id === id)).message;
  };
  return { programs, next, session, ask };
};

it('answers the handshake and lists its tools, every one of them reading only', { skip, timeout: 300_000 }, async () => {
  const { programs, next, session, ask } = harness();
  try {
    await programs.handle(session, 'mcp.start', { id: 'x-reader', bundled: 'x-reader', env: { X_COOKIES: COOKIES } });
    const hello = await ask(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(hello.result.protocolVersion, '2025-06-18');
    assert.equal(hello.result.serverInfo.name, 'willow-x-reader');
    assert.deepEqual(hello.result.capabilities, { tools: { listChanged: false } });

    const { result } = await ask(2, 'tools/list');
    const names = result.tools.map((tool) => tool.name);
    assert.deepEqual(names, [
      'search_posts', 'search_accounts', 'get_account', 'get_account_posts', 'get_post', 'get_replies', 'get_thread',
      'get_followers', 'get_following', 'get_trends', 'get_list_posts', 'get_bookmarks',
    ]);
    for (const tool of result.tools) {
      assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} reads only`);
      assert.equal(tool.inputSchema.type, 'object');
      assert.ok(tool.description.length > 20, `${tool.name} says what it does`);
    }
    assert.ok(!names.some((name) => /post_|tweet|like|follow_|repost|reply_|send|delete|bookmark_/.test(name)), 'no tool writes to X');

    const unknown = await ask(3, 'tools/call', { name: 'create_post', arguments: { text: 'hi' } });
    assert.equal(unknown.error.code, -32602);
    assert.deepEqual((await ask(4, 'ping')).result, {});

    await programs.handle(session, 'mcp.stop', { id: 'x-reader' });
    const exit = await next((name) => name === 'mcp.exit');
    assert.equal(exit.code, 0, 'its input closing ends it');
  } finally {
    programs.dispose();
  }
});

it('ends at once without both cookies, saying which one is missing', { skip, timeout: 300_000 }, async () => {
  const { programs, next, session } = harness();
  try {
    await programs.handle(session, 'mcp.start', { id: 'x-reader', bundled: 'x-reader', env: { X_COOKIES: 'ct0=0123456789abcdef' } });
    const exit = await next((name) => name === 'mcp.exit');
    assert.equal(exit.code, 1);
    assert.match(exit.stderr, /needs your x\.com session's auth_token cookie/);
    assert.ok(!exit.stderr.includes('0123456789abcdef'), 'what it says leaves the cookie out');
  } finally {
    programs.dispose();
  }
});
