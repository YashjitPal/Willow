/*
 * `device-emulator.cjs` for the remote-browser narrow work, held on this work's own windows only
 * (rb-window.cjs): Gemini Spark and the Willow test origin. The shared emulator holds the user's
 * Gemini tab and the :3000 Willow tab, which other agents use.
 *
 *   node tools/scratch/rb-emulator.cjs [mobile|tablet|desktop]
 *
 * Control: GET http://127.0.0.1:9341/<command>
 *   mobile | tablet | desktop   ?reload=0 skips the reload a user-agent change needs
 *   set?w=600&h=900             optional &touch=0 &mobile=0 &ua=phone|tablet|desktop
 *   status                      each tab's viewport, pointer and the window-fit scale
 *   refit                       re-measure the window after resizing it
 *
 * The emulated screen is scaled to fit the window (`scale` in status): CDP input coordinates
 * are window coordinates, so multiply page coordinates by it.
 */
const http = require('http');
const puppeteer = require('puppeteer-core');

const CDP_URL = 'http://[::1]:9222';
const PORT = Number(process.env.RB_EMULATOR_PORT || 9341);
const WILLOW = process.env.WILLOW_URL || 'http://localhost:3101';

const TABS = [
  { name: 'gemini', matches: (url) => url.startsWith('https://gemini.google.com/spark') },
  { name: 'willow', matches: (url) => url.startsWith(`${WILLOW}/`) },
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
  const { result, exceptionDetails } = await entry.session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
}

async function readIdentity() {
  for (let attempt = 0; attempt < 120; attempt++) {
    for (const entry of entries()) {
      const value = await evaluate(entry, `isSecureContext && navigator.userAgentData
        ? navigator.userAgentData.getHighEntropyValues(['fullVersionList', 'uaFullVersion']).then((v) => ({
            brands: navigator.userAgentData.brands, fullVersionList: v.fullVersionList, fullVersion: v.uaFullVersion,
            width: innerWidth, height: innerHeight,
          }))
        : null`).catch(() => null);
      if (value) return value;
    }
    await sleep(250);
  }
  throw new Error('no loaded tab of this work to read the browser identity from (rb-window.cjs open …)');
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
  await send('Emulation.setDeviceMetricsOverride', {
    width: emulation.width,
    height: emulation.height,
    deviceScaleFactor: emulation.dpr,
    mobile: emulation.mobile,
    scale: fitScale(emulation),
    screenWidth: emulation.width,
    screenHeight: emulation.height,
    screenOrientation: emulation.height >= emulation.width ? { type: 'portraitPrimary', angle: 0 } : { type: 'landscapePrimary', angle: 90 },
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: emulation.touch, maxTouchPoints: 5 });
  await send('Emulation.setEmitTouchEventsForMouse', { enabled: emulation.touch, configuration: 'mobile' });
  await send('Emulation.setUserAgentOverride', userAgentFor(emulation.ua));
}

async function reload(entry) {
  const loaded = new Promise((resolve) => entry.session.once('Page.loadEventFired', resolve));
  await entry.session.send('Page.reload');
  await withTimeout(loaded, 45000, `${entry.name} reload`).catch((err) => log(err.message));
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
      hoverNone: matchMedia('(hover: none)').matches,
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
  if (command in PRESETS) return switchTo(command, PRESETS[command] && { ...PRESETS[command] }, { reload: shouldReload });
  if (command === 'set') {
    const width = Number(query.get('w'));
    const height = Number(query.get('h'));
    if (!(width > 0 && height > 0)) throw new Error('set needs w and h');
    return switchTo(`custom ${width}x${height}`, {
      width,
      height,
      dpr: 0,
      mobile: query.get('mobile') !== '0',
      touch: query.get('touch') !== '0',
      ua: query.get('ua') || (width <= 768 ? 'phone' : 'tablet'),
    }, { reload: shouldReload });
  }
  if (command === 'status') return status();
  if (command === 'refit') return refit();
  return null;
}

(async () => {
  const initial = process.argv[2] || 'desktop';
  if (!(initial in PRESETS)) throw new Error(`unknown mode "${initial}"`);
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null });
  browser.on('disconnected', () => { log('browser disconnected, exiting'); process.exit(1); });
  browser.on('targetcreated', attach);
  browser.on('targetchanged', attach);
  browser.on('targetdestroyed', (target) => attached.delete(target));
  await Promise.all(browser.targets().map(attach));

  const probe = await readIdentity();
  identity = { brands: probe.brands, fullVersionList: probe.fullVersionList, fullVersion: probe.fullVersion };
  viewport = { width: probe.width, height: probe.height };
  log(`window viewport ${viewport.width}x${viewport.height}, Chrome ${identity.fullVersion}`);
  await switchTo(initial, PRESETS[initial] && { ...PRESETS[initial] }, { reload: initial !== 'desktop' });

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
  }).listen(PORT, '127.0.0.1', () => log(`control: http://127.0.0.1:${PORT}/<mobile|tablet|desktop|set|status|refit>`));
})().catch((err) => { console.error(err); process.exit(1); });
