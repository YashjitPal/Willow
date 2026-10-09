import { test } from 'node:test';
import assert from 'node:assert/strict';

const MODULE = '../../../platform/core/src/android-bridge.ts';

/** A page in Willow's Android app: the app's bridge, storage, and a computer that answers `fetch`. */
function phonePage(answer) {
  const storage = new Map();
  const sent = [];
  const requests = [];
  const app = { version: 1, agentsOrigin: 'http://localhost:41860', tools: ['phone_vibrate'], listeners: [], post: (message) => sent.push(message) };
  globalThis.window = globalThis;
  globalThis.__WILLOW_ANDROID__ = app;
  globalThis.location = { origin: 'http://localhost:41861' };
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined };
    requests.push(request);
    const reply = await answer(request);
    return { ok: reply.status === undefined || reply.status < 400, status: reply.status ?? 200, json: async () => reply.body ?? {} };
  };
  return { app, storage, sent, requests };
}

const fresh = () => import(`${MODULE}?case=${Math.random()}`);
const until = async (check) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('timed out');
};

test('the bridge is found only when the app set one up', async () => {
  phonePage(() => ({}));
  const bridge = await fresh();
  assert.equal(bridge.isAndroidApp(), true);
  globalThis.__WILLOW_ANDROID__ = { post: 'not a function' };
  assert.equal(bridge.isAndroidApp(), false);
  delete globalThis.__WILLOW_ANDROID__;
  assert.equal(bridge.androidApp(), null);
});

test('the agent tabs sign in with what the computer issues this phone', async () => {
  phonePage((request) => (request.url === '/api/willow/harness' ? { body: { token: 'one-time-credential' } } : { status: 404 }));
  const bridge = await fresh();
  assert.deepEqual(await bridge.androidHarnessConnection(), { url: 'http://localhost:41860', token: 'one-time-credential' });
});

test('a refused sign-in says why', async () => {
  phonePage(() => ({ status: 401, body: { error: 'This phone is not paired with this computer.' } }));
  const bridge = await fresh();
  await assert.rejects(bridge.androidHarnessConnection(), /not paired/);
});

test("the phone hands the computer's calls to the app and posts the app's answers back", async () => {
  let polls = 0;
  const page = phonePage((request) => {
    if (request.url === '/api/willow/session') return { body: { paired: true, companion: true } };
    if (request.url.startsWith('/api/willow/phone/next')) {
      polls += 1;
      // The second poll waits for good, which ends the loop for the test.
      return polls === 1 ? { body: { calls: [{ id: 'call-1', tool: 'phone_vibrate', args: { pattern: 'light' } }] } } : new Promise(() => {});
    }
    return { body: { ok: true } };
  });
  const bridge = await fresh();
  bridge.startAndroidPhone();
  bridge.startAndroidPhone();

  await until(() => page.sent.length > 0);
  assert.deepEqual(page.sent, [{ kind: 'phone-call', id: 'call-1', tool: 'phone_vibrate', args: { pattern: 'light' } }]);
  for (const listener of page.app.listeners) listener({ kind: 'phone-result', id: 'call-1', ok: true, result: { done: true } });
  await until(() => page.requests.some((request) => request.url === '/api/willow/phone/result'));

  const hello = page.requests.find((request) => request.url === '/api/willow/phone/hello');
  const result = page.requests.find((request) => request.url === '/api/willow/phone/result');
  assert.equal(page.requests.filter((request) => request.url === '/api/willow/phone/hello').length, 1, 'started once');
  assert.deepEqual(hello.body.tools, ['phone_vibrate']);
  assert.match(hello.body.phone, /^[A-Za-z0-9_-]{8,64}$/);
  assert.deepEqual(result.body, { phone: hello.body.phone, id: 'call-1', ok: true, result: { done: true } });
  assert.equal(page.storage.get('willow_companion_url'), 'ws://localhost:41861/api/willow/companion');
  assert.equal(page.storage.get('willow_phone_id'), hello.body.phone);
});
