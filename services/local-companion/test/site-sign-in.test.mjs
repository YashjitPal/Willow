/**
 * Signing in to a site for X Reader (src/site-sign-in.mjs): which browser opens, and — with a real one, headless,
 * signing in to a stand-in site on the loopback — the cookies it hands back, HttpOnly among them and as the site left
 * them, the window ending when Willow takes the sign-in back or the user closes it, and no profile left behind.
 * The browser tests are skipped on a computer with no Chrome, Edge, Brave or Chromium.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { browserArgs, createSiteSignIn, findBrowser, SITE_SIGN_INS } from '../src/site-sign-in.mjs';

it('opens Chrome, then Edge, Brave or Chromium, wherever each installs', () => {
  const env = { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' };
  const has = (...files) => (file) => files.includes(file);
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const chrome = 'C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
  assert.deepEqual(findBrowser({ platform: 'win32', env, exists: has(edge, chrome) }), { name: 'Chrome', file: chrome }, 'Chrome first, installed for one user too');
  assert.deepEqual(findBrowser({ platform: 'win32', env, exists: has(edge) }), { name: 'Edge', file: edge });
  assert.equal(findBrowser({ platform: 'win32', env, exists: () => false }), null);
  const brave = '/Users/me/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
  assert.deepEqual(findBrowser({ platform: 'darwin', env: {}, home: '/Users/me', exists: has(brave) }), { name: 'Brave', file: brave });
  assert.deepEqual(findBrowser({ platform: 'linux', env: { PATH: '/opt/bin:/usr/bin' }, exists: has('/usr/bin/chromium') }), { name: 'Chromium', file: '/usr/bin/chromium' });
  assert.deepEqual(findBrowser({ platform: 'linux', env: { WILLOW_CHROME_PATH: '/opt/chrome' }, exists: has('/opt/chrome') }), { name: 'Chrome', file: '/opt/chrome' });
});

it('starts the browser on a profile of its own, at the sign-in page, with nothing that marks it automated', () => {
  const args = browserArgs('/tmp/willow-sign-in-1', SITE_SIGN_INS['x.com'].url);
  assert.equal(args[0], '--user-data-dir=/tmp/willow-sign-in-1');
  assert.ok(args.includes('--remote-debugging-pipe'), 'a pipe, not a port another program could reach');
  assert.ok(args.includes('--disable-blink-features=AutomationControlled'));
  assert.ok(!args.some((arg) => /enable-automation|headless|remote-debugging-port/.test(arg)));
  assert.equal(args.at(-1), 'https://x.com/i/flow/login', 'X sends it on to whichever sign-in it runs now');
  assert.deepEqual(SITE_SIGN_INS['x.com'].cookies, ['auth_token', 'ct0']);
  assert.equal(SITE_SIGN_INS['x.com'].home, 'https://x.com/home');
});

it('signs in only to a site it knows, and says when there is no browser to do it in', async () => {
  const signIn = createSiteSignIn({ find: () => null });
  const window = {};
  await assert.rejects(signIn.handle(window, 'site.signIn', { site: 'accounts.google.com' }), /no sign-in for accounts\.google\.com/);
  await assert.rejects(signIn.handle(window, 'site.signIn', { site: 'toString' }), /no sign-in for toString/);
  await assert.rejects(signIn.handle(window, 'site.signIn', { site: 'x.com' }), /needs Chrome, Edge or Brave/);
  assert.deepEqual(await signIn.handle(window, 'site.cancel'), { cancelled: true }, 'nothing open is nothing to cancel');
});

const browser = findBrowser();
const skip = browser ? false : 'no Chrome, Edge, Brave or Chromium on this computer';

const waitFor = async (check, ms = 30_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out waiting for the browser.');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const ended = (child) => child.exitCode !== null || child.signalCode !== null;

/**
 * A stand-in site: a guest ct0 on its sign-in page; signing in sets the session's HttpOnly cookie, and the page it
 * goes on to replaces ct0, as X's does.
 */
const standIn = async ({ signsIn }) => {
  const seen = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    seen.push(url.pathname);
    if (url.pathname === '/login') {
      response.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'ct0=guest; Path=/' });
      // The person signing in, sped up.
      const script = signsIn
        ? '<script>setTimeout(() => fetch("/session", { method: "POST" }).then(() => setTimeout(() => { location.href = "/home"; }, 400)), 200);</script>'
        : '';
      response.end(`<!doctype html><title>Sign in</title><p>Sign in</p>${script}`);
    } else if (url.pathname === '/session') {
      response.writeHead(200, { 'set-cookie': ['auth_token=tok-123; Path=/; HttpOnly', 'lang=en; Path=/'] });
      response.end();
    } else if (url.pathname === '/home') {
      response.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'ct0=signed-456; Path=/' });
      response.end('<!doctype html><title>Home</title><p>Home</p>');
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const site = { url: `${origin}/login`, home: `${origin}/home`, signedIn: 'auth_token', cookies: ['auth_token', 'ct0'] };
  return { server, seen, site };
};

const signInWith = (site) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-sign-in-test-'));
  const launched = [];
  const signIn = createSiteSignIn({
    sites: { 'example.test': site },
    find: () => browser,
    start: (...args) => {
      const child = spawn(...args);
      launched.push(child);
      return child;
    },
    tmp,
    headless: true,
    pollMs: 100,
    settleMs: 300,
  });
  return { signIn, tmp, launched };
};

it('hands back the cookies the site left once the user is in, HttpOnly too, then closes the browser and its profile', { skip, timeout: 90_000 }, async () => {
  const { server, site } = await standIn({ signsIn: true });
  const { signIn, tmp, launched } = signInWith(site);
  try {
    const result = await signIn.handle({}, 'site.signIn', { site: 'example.test' });
    assert.deepEqual(result, { cookies: { auth_token: 'tok-123', ct0: 'signed-456' } }, 'ct0 as the site replaced it on the way in');
    assert.equal(launched.length, 1);
    assert.ok(ended(launched[0]), 'the browser has closed');
    assert.deepEqual(fs.readdirSync(tmp), [], 'its profile is gone');
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

it('ends the window when Willow takes the sign-in back, starts another, or goes away, or the user closes it', { skip, timeout: 120_000 }, async () => {
  const { server, seen, site } = await standIn({ signsIn: false });
  const { signIn, tmp, launched } = signInWith(site);
  const window = {};
  const logins = () => seen.filter((page) => page === '/login').length;
  try {
    const taken = signIn.handle(window, 'site.signIn', { site: 'example.test' });
    await waitFor(() => logins() === 1);
    assert.deepEqual(await signIn.handle(window, 'site.cancel'), { cancelled: true });
    assert.deepEqual(await taken, { cancelled: true });

    const replaced = signIn.handle(window, 'site.signIn', { site: 'example.test' });
    await waitFor(() => logins() === 2);
    const closed = signIn.handle(window, 'site.signIn', { site: 'example.test' });
    assert.deepEqual(await replaced, { cancelled: true }, 'a second sign-in from the same window ends the first');
    await waitFor(() => logins() === 3);
    // The user closing its window: the browser ends.
    launched[2].kill();
    assert.deepEqual(await closed, { cancelled: true });

    const left = signIn.handle(window, 'site.signIn', { site: 'example.test' });
    await waitFor(() => logins() === 4);
    signIn.release(window);
    assert.deepEqual(await left, { cancelled: true }, 'a window that disconnects takes its sign-in with it');

    assert.equal(launched.length, 4);
    await waitFor(() => launched.every(ended), 10_000);
    assert.deepEqual(fs.readdirSync(tmp), [], 'no profile left behind');
  } finally {
    await signIn.dispose();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
