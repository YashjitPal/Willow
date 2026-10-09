/**
 * Signing in to apps from the desktop app (src/oauth.mjs): a one-off loopback address that catches one answer and
 * says it, closing after; the sign-in page opened in the browser, https only.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createOAuth } from '../src/oauth.mjs';

it('catches one answer on the loopback, says it, and closes', async () => {
  const heard = [];
  const oauth = createOAuth({ broadcast: (name, payload) => heard.push({ name, payload }), open: async () => {} });
  try {
    const { id, redirectUri } = await oauth.handle('oauth.listen', {});
    assert.match(redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/, 'an IP literal and a port of its own');

    const wrong = await fetch(redirectUri.replace('/callback', '/elsewhere'));
    assert.equal(wrong.status, 404);
    const page = await fetch(`${redirectUri}?code=abc&state=xyz`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /You are signed in/);
    assert.deepEqual(heard, [{ name: 'oauth.callback', payload: { id, code: 'abc', state: 'xyz', error: undefined, errorDescription: undefined } }]);
    await assert.rejects(fetch(`${redirectUri}?code=again`), 'closed after one answer');
  } finally {
    oauth.dispose();
  }
});

it('passes on a refusal, honours a registered address, and gives up after its wait', async () => {
  const heard = [];
  const oauth = createOAuth({ broadcast: (name, payload) => heard.push(payload), open: async () => {}, waitMs: 80 });
  try {
    const { redirectUri } = await oauth.handle('oauth.listen', { port: 0, path: '/oauth/callback', host: 'localhost' });
    assert.match(redirectUri, /^http:\/\/localhost:\d+\/oauth\/callback$/);
    const page = await fetch(`${redirectUri.replace('localhost', '127.0.0.1')}?error=access_denied&error_description=No`);
    assert.match(await page.text(), /did not finish/);
    assert.equal(heard.at(-1).error, 'access_denied');
    assert.equal(heard.at(-1).errorDescription, 'No');

    const waiting = await oauth.handle('oauth.listen', {});
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepEqual(heard.at(-1), { id: waiting.id, error: 'timeout', errorDescription: 'Nobody finished signing in within ten minutes.' });

    await assert.rejects(oauth.handle('oauth.listen', { port: 80 }), /port from 1024/);
    await assert.rejects(oauth.handle('oauth.listen', { path: '/x?y' }), /not a path/);
  } finally {
    oauth.dispose();
  }
});

it('opens only an https sign-in page, handed over whole', async () => {
  const opened = [];
  const oauth = createOAuth({ broadcast: () => {}, open: async (url) => opened.push(url) });
  assert.deepEqual(await oauth.handle('oauth.open', { url: 'https://auth.example.com/authorize?a=1&b=2' }), { opened: true });
  assert.deepEqual(opened, ['https://auth.example.com/authorize?a=1&b=2']);
  await assert.rejects(oauth.handle('oauth.open', { url: 'file:///C:/Windows/System32/calc.exe' }), /Only an https/);
  await assert.rejects(oauth.handle('oauth.open', { url: 'not a url' }), /not a web address/);
  assert.deepEqual(oauth.requests, ['oauth.listen', 'oauth.open', 'oauth.cancel']);
});
