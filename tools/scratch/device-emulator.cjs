/*
 * Keeps the debug Chrome's Gemini and Willow tabs in DevTools-style device emulation.
 * CDP drops a session's emulation the moment that session detaches, so the emulation
 * lives exactly as long as this process.
 *
 *   node tools/scratch/device-emulator.cjs [mobile|tablet|desktop]
 *
 * Control: GET http://127.0.0.1:9339/<command>
 *   mobile | tablet | desktop   ?landscape=1 swaps the axes, ?reload=0 skips the reload
 *   set?w=600&h=900             optional &dpr= &touch=0 &mobile=0 &ua=phone|tablet|desktop
 *   status                      what each emulated tab reports about itself
 *   shot                        PNGs of the first Gemini and Willow tab
 *   refit                       re-measure the window after resizing it
 *
 * 390 and 800 are the widths the responsive work was measured at. DPR stays the
 * screen's own (0 = no override) so computed values match the desktop captures.
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CDP_URL = process.env.CDP_URL || 'http://[::1]:9222';
const PORT = Number(process.env.EMULATOR_PORT || 9339);
const SHOT_DIR = path.join(os.tmpdir(), 'willow-emulator');

const TABS = [
  {
    name: 'gemini',
    url: 'https://gemini.google.com/app',
    matches: (url) => url.startsWith('https://gemini.google.com/'),
  },
  {
    name: 'willow',
    url: 'http://localhost:3000/',
    matches: (url) => /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):3000\//.test(url),
  },
];

const PRESETS = {
  mobile: { width: 390, height: 844, dpr: 0, mobile: true, touch: true, ua: 'phone' },
  tablet: { width: 800, height: 1280, dpr: 0, mobile: true, touch: true, ua: 'tablet' },
  desktop: null,
};

const log = (...args) => console.log(new Date().toTimeString().slice(0, 8), ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const withTimeout = (promise, ms, what) => Promise.race([
  promise,
  sleep(ms).then(() => { throw new Error(`${what} timed out after ${ms}ms`); }),
]);

const attached = new Map();
let mode = 'desktop';
let emulation = null;
let identity = null;
let viewport = null;

const entries = () => [...attached.values()].filter((entry) => entry.session);

async function forAll(action) {
  const results = await Promise.allSettled(entries().map(action));
  results.forEach((result) => result.status === 'rejected' && log(result.reason?.message || result.reason));
}

async function evaluate(entry, expression) {
  const { result, exceptionDetails } = await entry.session.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
}

async function readIdentity() {
  for (let attempt = 0; attempt < 120; attempt++) {
    for (const entry of entries()) {
      const value = await evaluate(entry, `isSecureContext && navigator.userAgentData
        ? navigator.userAgentData.getHighEntropyValues(['fullVersionList', 'uaFullVersion']).then((v) => ({
            brands: navigator.userAgentData.brands,
            fullVersionList: v.fullVersionList,
            fullVersion: v.uaFullVersion,
            width: innerWidth,
            height: innerHeight,
          }))
        : null`).catch(() => null);
      if (value) return value;
    }
    await sleep(250);
  }
  throw new Error('no loaded Gemini or Willow tab to read the browser identity from');
}

function userAgentFor(kind) {
  if (!kind || kind === 'desktop') return { userAgent: '' };
  const major = identity.fullVersion.split('.')[0];
  const phone = kind === 'phone';
  return {
    userAgent: `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0${phone ? ' Mobile' : ''} Safari/537.36`,
    userAgentMetadata: {
      brands: identity.brands,
      fullVersionList: identity.fullVersionList,
      fullVersion: identity.fullVersion,
      platform: 'Android',
      platformVersion: '14.0.0',
      architecture: '',
      model: '',
      mobile: phone,
    },
  };
}

const fitScale = (size) => Math.floor(Math.min(1, viewport.width / size.width, viewport.height / size.height) * 1000) / 1000;

async function applyTo(entry) {
  const send = (method, params) => entry.session.send(method, params);
  if (!emulation) {
    await send('Emulation.clearDeviceMetricsOverride');
    await send('Emulation.setEmitTouchEventsForMouse', { enabled: false });
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await send('Emulation.setUserAgentOverride', { userAgent: '' });
    return;
  }
  const portrait = emulation.height >= emulation.width;
  await send('Emulation.setDeviceMetricsOverride', {
    width: emulation.width,
    height: emulation.height,
    deviceScaleFactor: emulation.dpr,
    mobile: emulation.mobile,
    scale: fitScale(emulation),
    screenWidth: emulation.width,
    screenHeight: emulation.height,
    screenOrientation: portrait ? { type: 'portraitPrimary', angle: 0 } : { type: 'landscapePrimary', angle: 90 },
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: emulation.touch, maxTouchPoints: 5 });
  await send('Emulation.setEmitTouchEventsForMouse', { enabled: emulation.touch, configuration: 'mobile' });
  await send('Emulation.setUserAgentOverride', userAgentFor(emulation.ua));
}

async function reload(entry) {
  const loaded = new Promise((resolve) => entry.session.once('Page.loadEventFired', resolve));
  await entry.session.send('Page.reload');
  await withTimeout(loaded, 30000, `${entry.name} reload`).catch((err) => log(err.message));
}

async function attach(target) {
  if (target.type() !== 'page' || attached.has(target)) return;
  const tab = TABS.find((candidate) => candidate.matches(target.url()));
  if (!tab) return;
  const entry = { name: tab.name, session: null };
  attached.set(target, entry);
  try {
    const session = await target.createCDPSession();
    await session.send('Page.enable');
    entry.session = session;
    if (viewport) await applyTo(entry);
    log(`attached ${tab.name}: ${target.url()}`);
  } catch (err) {
    attached.delete(target);
    log(`could not attach ${tab.name}: ${err.message}`);
  }
}

async function status() {
  const tabs = await Promise.all(entries().map(async (entry) => ({
    tab: entry.name,
    ...(await evaluate(entry, `({
      url: location.href,
      viewport: innerWidth + 'x' + innerHeight,
      dpr: devicePixelRatio,
      coarsePointer: matchMedia('(pointer: coarse)').matches,
      maxTouchPoints: navigator.maxTouchPoints,
      userAgent: navigator.userAgent,
      visibility: document.visibilityState,
    })`).catch((err) => ({ error: err.message }))),
  })));
  return { mode, emulation, scale: emulation ? fitScale(emulation) : 1, window: viewport, tabs };
}

async function switchTo(nextMode, next, { reload: shouldReload }) {
  const uaChanged = (emulation?.ua ?? 'desktop') !== (next?.ua ?? 'desktop');
  mode = nextMode;
  emulation = next;
  await forAll(applyTo);
  if (shouldReload && uaChanged) await forAll(reload);
  log(`mode: ${mode}${next ? ` ${next.width}x${next.height} at scale ${fitScale(next)}` : ''}`);
  return status();
}

async function shoot() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const list = entries();
  const visibility = await Promise.all(list.map((entry) => evaluate(entry, 'document.visibilityState').catch(() => 'hidden')));
  const front = list[visibility.indexOf('visible')];
  const files = {};
  for (const tab of TABS) {
    const entry = list.find((candidate) => candidate.name === tab.name);
    if (!entry) continue;
    await entry.session.send('Page.bringToFront');
    await sleep(600);
    const { data } = await withTimeout(
      entry.session.send('Page.captureScreenshot', { format: 'png' }),
      15000,
      `${tab.name} screenshot`,
    );
    files[tab.name] = path.join(SHOT_DIR, `${tab.name}-${mode.replace(/\W+/g, '-')}.png`);
    fs.writeFileSync(files[tab.name], Buffer.from(data, 'base64'));
  }
  if (front) await front.session.send('Page.bringToFront');
  return files;
}

async function refit() {
  const [entry] = entries();
  await entry.session.send('Emulation.clearDeviceMetricsOverride');
  await sleep(300);
  viewport = await evaluate(entry, '({ width: innerWidth, height: innerHeight })');
  await forAll(applyTo);
  return status();
}

async function handle(command, query) {
  const shouldReload = query.get('reload') !== '0';
  if (command in PRESETS) {
    const next = PRESETS[command] && { ...PRESETS[command] };
    const landscape = next && query.get('landscape') === '1';
    if (landscape) [next.width, next.height] = [next.height, next.width];
    return switchTo(landscape ? `${command} landscape` : command, next, { reload: shouldReload });
  }
  if (command === 'set') {
    const width = Number(query.get('w'));
    const height = Number(query.get('h'));
    if (!(width > 0 && height > 0)) throw new Error('set needs w and h');
    return switchTo(`custom ${width}x${height}`, {
      width,
      height,
      dpr: Number(query.get('dpr') || 0),
      mobile: query.get('mobile') !== '0',
      touch: query.get('touch') !== '0',
      ua: query.get('ua') || (width <= 768 ? 'phone' : 'tablet'),
    }, { reload: shouldReload });
  }
  if (command === 'status') return status();
  if (command === 'shot') return shoot();
  if (command === 'refit') return refit();
  return null;
}

(async () => {
  const initial = process.argv[2] || 'mobile';
  if (!(initial in PRESETS)) throw new Error(`unknown mode "${initial}"`);

  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null });
  browser.on('disconnected', () => {
    log('browser disconnected, exiting');
    process.exit(1);
  });
  browser.on('targetcreated', attach);
  browser.on('targetchanged', attach);
  browser.on('targetdestroyed', (target) => attached.delete(target));
  await Promise.all(browser.targets().map(attach));

  const browserSession = await browser.target().createCDPSession();
  for (const tab of TABS) {
    if (!entries().some((entry) => entry.name === tab.name)) {
      await browserSession.send('Target.createTarget', { url: tab.url, background: true });
    }
  }

  const probe = await readIdentity();
  identity = { brands: probe.brands, fullVersionList: probe.fullVersionList, fullVersion: probe.fullVersion };
  viewport = { width: probe.width, height: probe.height };
  log(`window viewport ${viewport.width}x${viewport.height}, Chrome ${identity.fullVersion}`);

  await switchTo(initial, PRESETS[initial] && { ...PRESETS[initial] }, { reload: true });

  http.createServer(async (req, res) => {
    const { pathname, searchParams } = new URL(req.url, 'http://localhost');
    try {
      const body = await handle(pathname.slice(1), searchParams);
      res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body ?? { error: `unknown command ${pathname}` }, null, 2));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }).listen(PORT, '127.0.0.1', () => log(`control: http://127.0.0.1:${PORT}/<mobile|tablet|desktop|set|status|shot|refit>`));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
