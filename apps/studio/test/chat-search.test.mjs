import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importTs } from './ts-module.mjs';

const { runChatSearch, createChatBodyLoader } = await importTs(new URL('../src/shell/chat-search.ts', import.meta.url).pathname);
const chat = (chatId, updatedAt = 1) => ({ chatId, updatedAt });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const setup = (overrides = {}) => {
  const updates = [];
  const controller = new AbortController();
  const options = {
    query: 'needle', chats: [chat('one'), chat('two')],
    loadBody: async () => 'needle', signal: controller.signal,
    onResults: (results) => updates.push(results.map(({ chatId }) => chatId)),
    ...overrides,
  };
  return { options, updates, controller };
};

test('semantic ranking precedes unindexed text matches, without duplicates', async () => {
  const { options, updates } = setup({
    chats: ['unindexed', 'lower', 'highest', 'irrelevant', 'invalid'].map((id) => chat(id)),
    loadBody: async ({ chatId }) => chatId === 'irrelevant' ? 'unrelated' : 'needle',
    semantic: {
      embedQuery: async () => [1, 0],
      loadVector: async ({ chatId }) => ({ lower: [0.5, 0.5], highest: [1, 0], irrelevant: [0, 1], invalid: [0, 0] })[chatId] ?? null,
    },
  });
  await runChatSearch(options);
  assert.deepEqual(updates.at(-1), ['highest', 'lower', 'unindexed', 'invalid']);
});

test('semantic mode caps results at 30; lexical mode preserves all matches and order', async () => {
  const chats = Array.from({ length: 35 }, (_, i) => chat(`chat-${i}`));
  const { options, updates } = setup({ chats, semantic: {
    embedQuery: async () => [1], loadVector: async () => null,
  } });
  await runChatSearch(options);
  assert.deepEqual(updates.at(-1), chats.slice(0, 30).map(({ chatId }) => chatId));
  await runChatSearch({ ...options, semantic: undefined });
  assert.equal(updates.at(-1).length, 35);
});

test('embedding errors fall back to progressive text matches', async () => {
  const { options, updates } = setup({ semantic: {
    embedQuery: async () => { throw new Error('offline'); },
    loadVector: async () => { throw new Error('must not rank'); },
  } });
  await runChatSearch(options);
  assert.deepEqual(updates, [['one'], ['one', 'two'], ['one', 'two']]);
});

test('embedding timeout falls back and clears its timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let embeddingSignal;
  const { options, updates } = setup({ semantic: {
    embedQuery: (signal) => new Promise((_, reject) => {
      embeddingSignal = signal;
      signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true });
    }),
    loadVector: async () => null,
  } });
  const running = runChatSearch(options);
  t.mock.timers.tick(19_999);
  assert.equal(embeddingSignal.aborted, false);
  t.mock.timers.tick(1);
  await running;
  assert.deepEqual(updates.at(-1), ['one', 'two']);
});

test('cancellation aborts embedding without running text fallback', async () => {
  let reads = 0;
  const { options, updates, controller } = setup({
    loadBody: async () => { reads++; return 'needle'; },
    semantic: {
      embedQuery: (signal) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
      }),
      loadVector: async () => null,
    },
  });
  const running = runChatSearch(options);
  controller.abort();
  await running;
  assert.equal(reads, 0);
  assert.deepEqual(updates, []);
});

test('a delayed old query cannot publish after its replacement finishes', async () => {
  const pending = deferred();
  const old = setup({ loadBody: () => pending.promise });
  const running = runChatSearch(old.options);
  old.controller.abort();
  const next = setup({ chats: [chat('new')] });
  await runChatSearch(next.options);
  pending.resolve('needle');
  await running;
  assert.deepEqual(old.updates, []);
  assert.deepEqual(next.updates.at(-1), ['new']);
});

test('cancelled semantic ranking cannot publish a delayed vector', async () => {
  const vector = deferred();
  const started = deferred();
  const { options, updates, controller } = setup({ semantic: {
    embedQuery: async () => [1],
    loadVector: () => { started.resolve(); return vector.promise; },
  } });
  const running = runChatSearch(options);
  await started.promise;
  controller.abort();
  vector.resolve([1]);
  await running;
  assert.deepEqual(updates, []);
});

test('scope-owned caches isolate identical IDs/timestamps and late old reads', async () => {
  const oldRead = deferred();
  const oldScope = createChatBodyLoader(() => oldRead.promise);
  let reads = 0;
  const newScope = createChatBodyLoader(async () => { reads++; return [{ content: 'new scope' }]; });
  const candidate = chat('same');
  const pending = oldScope(candidate);
  assert.equal(await newScope(candidate), 'new scope');
  oldRead.resolve([{ content: 'old scope' }]);
  assert.equal(await pending, 'old scope');
  assert.equal(await newScope(candidate), 'new scope');
  assert.equal(reads, 1);
  await newScope(chat('same', 2));
  assert.equal(reads, 2);
});

test('failed body reads are retried instead of cached as empty', async () => {
  let reads = 0;
  const load = createChatBodyLoader(async () => {
    if (++reads === 1) throw new Error('temporary read failure');
    return ['message', { content: 'content', thinkingText: 'thought' }];
  });
  assert.equal(await load(chat('one')), '');
  assert.equal(await load(chat('one')), 'message content thought');
});

test('search retries unavailable bodies and finds recovered messages at the same timestamp', async () => {
  let reads = 0;
  const loadBody = createChatBodyLoader(async () => {
    if (++reads === 1) return null;
    return [{ content: 'needle' }];
  });
  const { options, updates } = setup({ chats: [chat('one')], loadBody });

  await runChatSearch(options);
  assert.deepEqual(updates.at(-1), []);
  assert.equal(reads, 1);

  await runChatSearch(options);
  assert.deepEqual(updates.at(-1), ['one']);
  assert.equal(reads, 2);

  await runChatSearch(options);
  assert.deepEqual(updates.at(-1), ['one']);
  assert.equal(reads, 2);
});

test('empty message arrays remain cached until the timestamp changes', async () => {
  let reads = 0;
  const load = createChatBodyLoader(async () => { reads++; return []; });

  assert.equal(await load(chat('one')), '');
  assert.equal(await load(chat('one')), '');
  assert.equal(reads, 1);

  assert.equal(await load(chat('one', 2)), '');
  assert.equal(reads, 2);
});
