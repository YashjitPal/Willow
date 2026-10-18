/**
 * Signing in to a site for a program Willow ships that reads it as the user (X Reader). A browser window of its own
 * opens the site's sign-in page; once the user is in, the cookies the program needs go back to the window that asked,
 * and the browser closes. The browser is Chrome, Edge, Brave or Chromium — the first this computer has — on a profile
 * made for this one sign-in and deleted after it, so it sees none of the user's own browsing and keeps nothing. The
 * session is the site's like any other sign-in: logging out in the user's own browser leaves it be.
 *
 * It is driven over its DevTools pipe, which here only reads cookies and which pages are open. Nothing attaches to a
 * page, so the sign-in runs as it would in any browser.
 *
 * - `site.signIn { site }` → `{ cookies }`, by name, once the user is in; `{ cancelled: true }` when they closed the
 *   window or the window took it back. One per window: a second ends the first. Ten minutes at most.
 * - `site.cancel {}`.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * The sites a sign-in can be for: where it starts, where the site takes someone once they are in, the cookie that says
 * they are, and the cookies handed back. The window names only the site, so nothing it sends can open another page or
 * ask for other cookies.
 */
export const SITE_SIGN_INS = {
  'x.com': { url: 'https://x.com/i/flow/login', home: 'https://x.com/home', signedIn: 'auth_token', cookies: ['auth_token', 'ct0'] },
};

const WAIT_MS = 10 * 60_000;
const POLL_MS = 500;
// Signed in, the page goes on to the site's home, and the site may still replace a cookie on the way: the cookies are
// read once it is there, or after the longer wait if it goes elsewhere.
const SETTLE_MS = 1_500;
const SETTLE_MAX_MS = 8_000;
const PROFILE_PREFIX = 'willow-sign-in-';
// A profile left by a companion that stopped mid-sign-in; a sign-in lasts ten minutes at most.
const STALE_MS = 3600_000;

const WINDOWS_BROWSERS = [
  ['Chrome', 'Google/Chrome/Application/chrome.exe'],
  ['Edge', 'Microsoft/Edge/Application/msedge.exe'],
  ['Brave', 'BraveSoftware/Brave-Browser/Application/brave.exe'],
  ['Chromium', 'Chromium/Application/chrome.exe'],
];
const MAC_BROWSERS = [
  ['Chrome', 'Google Chrome.app/Contents/MacOS/Google Chrome'],
  ['Edge', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  ['Brave', 'Brave Browser.app/Contents/MacOS/Brave Browser'],
  ['Chromium', 'Chromium.app/Contents/MacOS/Chromium'],
];
const LINUX_BROWSERS = [
  ['Chrome', ['google-chrome', 'google-chrome-stable']],
  ['Edge', ['microsoft-edge', 'microsoft-edge-stable']],
  ['Brave', ['brave-browser', 'brave']],
  ['Chromium', ['chromium', 'chromium-browser']],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The browser a sign-in opens in: the first of Chrome, Edge, Brave and Chromium this computer has, or null. */
export const findBrowser = ({ platform = process.platform, env = process.env, exists = existsSync, home = os.homedir() } = {}) => {
  if (env.WILLOW_CHROME_PATH && exists(env.WILLOW_CHROME_PATH)) return { name: 'Chrome', file: env.WILLOW_CHROME_PATH };
  const first = (candidates) => candidates.find(({ file }) => exists(file)) ?? null;
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    return first(WINDOWS_BROWSERS.flatMap(([name, tail]) => roots.map((root) => ({ name, file: path.win32.join(root, tail) }))));
  }
  if (platform === 'darwin') {
    const roots = ['/Applications', path.posix.join(home, 'Applications')];
    return first(MAC_BROWSERS.flatMap(([name, tail]) => roots.map((root) => ({ name, file: path.posix.join(root, tail) }))));
  }
  const dirs = [...String(env.PATH || '').split(':').filter(Boolean), '/usr/bin', '/usr/local/bin', '/snap/bin'];
  return first(LINUX_BROWSERS.flatMap(([name, commands]) => commands.flatMap((command) => dirs.map((dir) => ({ name, file: path.posix.join(dir, command) })))));
};

/** How the browser starts: on its own profile, with the DevTools pipe, at the sign-in page. */
export const browserArgs = (profile, url, headless = false) => [
  `--user-data-dir=${profile}`,
  '--remote-debugging-pipe',
  // The pipe marks pages as automated (navigator.webdriver) unless told not to, and a sign-in may hold that against
  // the person signing in.
  '--disable-blink-features=AutomationControlled',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-search-engine-choice-screen',
  '--disable-sync',
  '--window-size=560,820',
  ...(headless ? ['--headless=new'] : []),
  url,
];

/** The cookies set for `host` (or a domain above it), by name, the one at `/` where a name has several. */
const cookieJar = (cookies, host) => {
  const jar = new Map();
  for (const cookie of cookies ?? []) {
    const domain = String(cookie.domain ?? '').replace(/^\./, '');
    if (!cookie.value || !(host === domain || host.endsWith(`.${domain}`))) continue;
    if (!jar.has(cookie.name) || cookie.path === '/') jar.set(cookie.name, cookie.value);
  }
  return jar;
};

/** Chrome's DevTools over the pipe `--remote-debugging-pipe` opens: JSON messages ending in a NUL, fd 3 in, fd 4 out. */
class DevToolsPipe {
  constructor(input, output) {
    this.input = input;
    this.next = 0;
    this.waiting = new Map();
    this.closed = false;
    let buffer = '';
    output.setEncoding('utf8');
    output.on('data', (text) => {
      buffer += text;
      for (let end = buffer.indexOf('\0'); end >= 0; end = buffer.indexOf('\0')) {
        const raw = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let message;
        try {
          message = JSON.parse(raw);
        } catch {
          continue;
        }
        const entry = this.waiting.get(message.id);
        if (!entry) continue;
        this.waiting.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(message.error.message || 'The browser refused the request.'));
        else entry.resolve(message.result ?? {});
      }
    });
    const close = () => this.close();
    output.on('close', close);
    output.on('error', close);
    input.on('error', close);
  }

  send(method, params = {}, timeoutMs = 10_000) {
    if (this.closed) return Promise.reject(new Error('The browser has closed.'));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`The browser did not answer ${method}.`));
      }, timeoutMs);
      this.waiting.set(id, { resolve, reject, timer });
      this.input.write(`${JSON.stringify({ id, method, params })}\0`);
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.waiting.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('The browser has closed.'));
    }
    this.waiting.clear();
  }
}

/**
 * @param {{ sites?: typeof SITE_SIGN_INS, find?: () => ({ name: string, file: string } | null), start?: typeof spawn,
 *   tmp?: string, headless?: boolean, waitMs?: number, pollMs?: number, settleMs?: number, log?: Function }} options
 */
export function createSiteSignIn({
  sites = SITE_SIGN_INS,
  find = findBrowser,
  start = spawn,
  tmp = os.tmpdir(),
  headless = false,
  waitMs = WAIT_MS,
  pollMs = POLL_MS,
  settleMs = SETTLE_MS,
  log = () => {},
} = {}) {
  /** The sign-in each window has open, by its companion session. */
  const open = new Map();

  const sweep = async () => {
    let names;
    try {
      names = await fs.readdir(tmp);
    } catch {
      return;
    }
    await Promise.all(names.filter((name) => name.startsWith(PROFILE_PREFIX)).map(async (name) => {
      const dir = path.join(tmp, name);
      try {
        if (Date.now() - (await fs.stat(dir)).mtimeMs > STALE_MS) await fs.rm(dir, { recursive: true, force: true });
      } catch {}
    }));
  };

  const closeBrowser = async (child, pipe, exited) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    if (pipe && !pipe.closed) await pipe.send('Browser.close', {}, 3_000).catch(() => undefined);
    if (await Promise.race([exited.then(() => true), sleep(5_000).then(() => false)])) return;
    child.kill();
    await Promise.race([exited, sleep(3_000)]);
  };

  /** One sign-in, from opening the browser to deleting its profile. */
  const signInOnce = async (site, browser, run) => {
    void sweep();
    const host = new URL(site.url).hostname;
    const profile = await fs.mkdtemp(path.join(tmp, PROFILE_PREFIX));
    let child = null;
    let pipe = null;
    let exited = Promise.resolve();
    try {
      child = start(browser.file, browserArgs(profile, site.url, headless), { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
      exited = new Promise((resolve) => {
        child.once('exit', resolve);
        child.once('error', resolve);
      });
      pipe = new DevToolsPipe(child.stdio[3], child.stdio[4]);
      const devtools = pipe;
      void exited.then(() => devtools.close());
      const opened = await Promise.race([
        pipe.send('Browser.getVersion', {}, 30_000).then(() => 'open', () => 'gone'),
        exited.then(() => 'gone'),
        run.stopped.then(() => 'stopped'),
      ]);
      if (opened === 'stopped') return { cancelled: true };
      if (opened === 'gone') throw new Error(`${browser.name} didn’t open. Try again, or paste the cookies instead.`);
      log('sign-in window open', host, browser.name);

      const deadline = Date.now() + waitMs;
      let since = 0;
      let sawPage = false;
      for (;;) {
        if (run.ended || pipe.closed) return { cancelled: true };
        if (Date.now() >= deadline) {
          throw new Error(`Nobody signed in to ${host} within ${Math.max(1, Math.round(waitMs / 60_000))} minutes, so Willow closed the window.`);
        }
        let cookies;
        let pages;
        try {
          const [jar, targets] = await Promise.all([pipe.send('Storage.getCookies'), pipe.send('Target.getTargets')]);
          cookies = jar.cookies;
          pages = (targets.targetInfos ?? []).filter((target) => target.type === 'page');
        } catch (error) {
          if (run.ended || pipe.closed) return { cancelled: true };
          throw error;
        }
        // A window closed while its browser carries on (a Mac's way) is as good as the browser closing.
        if (pages.length > 0) sawPage = true;
        else if (sawPage) return { cancelled: true };
        const jar = cookieJar(cookies, host);
        if (jar.has(site.signedIn)) {
          since ||= Date.now();
          const waited = Date.now() - since;
          const onward = pages.some((page) => String(page.url).startsWith(site.home));
          const missing = site.cookies.filter((name) => !jar.has(name));
          if (missing.length === 0 && ((onward && waited >= settleMs) || waited >= SETTLE_MAX_MS)) {
            log('signed in', host);
            return { cookies: Object.fromEntries(site.cookies.map((name) => [name, jar.get(name)])) };
          }
          if (waited >= SETTLE_MAX_MS) {
            throw new Error(`${host} signed you in without the ${missing.join(' and ')} cookie Willow needs. Try again, or paste the cookies instead.`);
          }
        } else {
          since = 0;
        }
        await Promise.race([sleep(pollMs), run.stopped, exited]);
      }
    } finally {
      await closeBrowser(child, pipe, exited);
      await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
        .catch((error) => log('could not remove a sign-in profile', error?.message));
    }
  };

  const signIn = async (session, payload) => {
    const name = String(payload.site ?? '');
    const site = Object.hasOwn(sites, name) ? sites[name] : null;
    if (!site) throw new Error(`Willow has no sign-in for ${name || 'that site'}.`);
    const browser = find();
    if (!browser) throw new Error('Signing in from Willow needs Chrome, Edge or Brave on this computer. Paste the cookies instead.');
    open.get(session)?.stop();
    const run = { ended: false };
    run.stopped = new Promise((resolve) => {
      run.stop = () => {
        run.ended = true;
        resolve();
      };
    });
    open.set(session, run);
    run.done = signInOnce(site, browser, run);
    try {
      return await run.done;
    } finally {
      if (open.get(session) === run) open.delete(session);
    }
  };

  return {
    requests: ['site.signIn', 'site.cancel'],
    async handle(session, type, payload = {}) {
      if (type === 'site.signIn') return signIn(session, payload);
      if (type === 'site.cancel') {
        open.get(session)?.stop();
        return { cancelled: true };
      }
      throw new Error(`Unknown companion request: ${type}`);
    },
    /** A window that disconnects takes its sign-in window with it. */
    release(session) {
      open.get(session)?.stop();
    },
    async dispose() {
      const runs = [...open.values()];
      for (const run of runs) run.stop();
      await Promise.allSettled(runs.map((run) => run.done));
    },
  };
}
