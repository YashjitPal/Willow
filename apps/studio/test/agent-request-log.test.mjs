/**
 * The model-request log.
 *
 * It exists to answer one question that is invisible from the outside: when a
 * turn pauses between paragraphs, is the endpoint slow to start, slow to
 * stream, or failing? So the timings have to separate those, and the log must
 * never become a second copy of the user's code or their key.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { beforeEach, it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const log = await importTs(
  path.join(repoRoot, 'features', 'code', 'src', 'agent', 'harness', 'runtime', 'request-log.ts'),
);

const OPTIONS = {
  provider: 'gemini',
  model: 'gemini-3-pro',
  apiKey: 'sk-super-secret-value',
  reasoningEffort: 'high',
  thinkingLevel: 4,
  baseUrl: 'https://relay.example.com/v1/chat?token=abc',
};

const MESSAGES = [
  { role: 'user', content: 'a'.repeat(100) },
  { role: 'assistant', content: 'b'.repeat(50) },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => log.clearRequestLog());

const call = (transport, options = OPTIONS) =>
  log.instrumentTransport(transport)(MESSAGES, options, () => {}, () => {}, 'SYSTEM PROMPT');

/* ---------------------------------------------------------------------- */

it('separates waiting for the endpoint from receiving the answer', async () => {
  // The distinction the log exists for: a long pause before the first token is
  // the endpoint; a long tail after it is the model streaming.
  await call(async (_m, _o, onToken) => {
    await sleep(60);
    onToken('hello');
    await sleep(40);
    onToken(' world');
  });

  const [entry] = log.requestLog.get();
  assert.equal(entry.status, 'ok');
  assert.ok(entry.firstTokenMs >= 50, `first token should reflect the wait, got ${entry.firstTokenMs}`);
  assert.ok(entry.totalMs >= entry.firstTokenMs, 'total covers the whole request');
  assert.equal(entry.responseChars, 'hello world'.length);
  assert.equal(entry.tokenEvents, 2);
});

it('records prompt size, which is what grows across a turn', async () => {
  await call(async () => {});

  const [entry] = log.requestLog.get();
  assert.equal(entry.systemChars, 'SYSTEM PROMPT'.length);
  assert.equal(entry.messageCount, 2);
  assert.equal(entry.promptChars, 150);
});

it('never records the key or the message content', async () => {
  await call(async (_m, _o, onToken) => onToken('some generated code'));

  const dump = log.dumpRequestLog();
  assert.doesNotMatch(dump, /sk-super-secret-value/, 'the key must never be logged');
  assert.doesNotMatch(dump, /aaaa/, 'prompt content must never be logged');
  assert.doesNotMatch(dump, /some generated code/, 'responses must never be logged');
  // Sizes are what explain the timings, and they are safe.
  assert.match(dump, /"promptChars": 150/);
});

it('keeps the endpoint host but not the URL or its query', async () => {
  await call(async () => {});

  const [entry] = log.requestLog.get();
  assert.equal(entry.endpoint, 'relay.example.com');
  assert.doesNotMatch(log.dumpRequestLog(), /token=abc/);
});

it('records a failure with its message, and re-throws', async () => {
  await assert.rejects(
    () => call(async () => { throw new Error('502 Bad Gateway'); }),
    /502 Bad Gateway/,
    'the caller must still see the failure',
  );

  const [entry] = log.requestLog.get();
  assert.equal(entry.status, 'error');
  assert.equal(entry.error.message, '502 Bad Gateway');
});

it('separates a user cancellation from a failure', async () => {
  // A session of cancellations should not read as a session of errors.
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(() =>
    call(
      async () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      },
      { ...OPTIONS, signal: controller.signal },
    ),
  );

  assert.equal(log.requestLog.get()[0].status, 'aborted');
});

it('logs every request, including the ones sub-agents make', async () => {
  const transport = log.instrumentTransport(async () => {});
  await transport(MESSAGES, OPTIONS, () => {}, () => {}, 'S');
  await transport(MESSAGES, OPTIONS, () => {}, () => {}, 'S');
  await transport(MESSAGES, OPTIONS, () => {}, () => {}, 'S');

  assert.equal(log.requestLog.get().length, 3);
});

it('times tool runs, which is where the unexplained gaps were', async () => {
  /*
   * A turn showed a two-minute gap between two rounds with no request in
   * flight. Tools were not timed, and `computer_use` drives its own model
   * session that never passes through the transport — so the time was real and
   * invisible. Both kinds now share one timeline.
   */
  const finish = log.beginToolLog('computer_use');
  const [entry] = log.requestLog.get();
  assert.equal(entry.kind, 'tool');
  assert.equal(entry.name, 'computer_use');
  assert.equal(entry.status, 'running');

  await sleep(30);
  finish();

  const [done] = log.requestLog.get();
  assert.equal(done.status, 'ok');
  assert.ok(done.totalMs >= 25, `expected a real duration, got ${done.totalMs}`);
});

it('records a failed tool with its reason', async () => {
  const finish = log.beginToolLog('apply_patch');
  finish(new Error('context not found'));

  const [entry] = log.requestLog.get();
  assert.equal(entry.status, 'error');
  assert.equal(entry.error.message, 'context not found');
});

it('does not record tool arguments', async () => {
  log.beginToolLog('read_file')();
  assert.doesNotMatch(log.dumpRequestLog(), /path|content/);
});

it('passes the transport result and arguments straight through', async () => {
  let seenSystem;
  const transport = log.instrumentTransport(async (_m, _o, _t, _s, system) => {
    seenSystem = system;
    return 'result';
  });

  const result = await transport(MESSAGES, OPTIONS, () => {}, () => {}, 'SYSTEM');
  assert.equal(result, 'result');
  assert.equal(seenSystem, 'SYSTEM');
});
