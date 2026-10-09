/**
 * Willow /models-settings at the current emulator size: visits every state a user can
 * reach without changing anything — the overview, each provider's detail page, the
 * "Add custom model" expander open, and every dropdown open — and scans each for sideways
 * scrolling or elements past the screen edge. Opens and closes UI only: never taps Add,
 * Remove, Save, or a dropdown option. Prints no text beyond UI structure.
 *
 *   node tools/scratch/models-walk.cjs [--label=phone]
 */
const http = require('http');
const puppeteer = require('puppeteer-core');

const LABEL = (process.argv.find((a) => a.startsWith('--label=')) || '--label=walk').slice(8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (url) => new Promise((resolve) => {
  http.get(url, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
  }).on('error', () => resolve(null));
});

const SCAN = () => {
  const W = innerWidth;
  const name = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 4).join('.')}` : ''}`;
  const INTENTIONAL = '.gems-premade-cards, .gem-zero-starters, [data-scroll-x], .snap-x, .overflow-x-auto, .sr-only, aside.studio-sidebar';
  const visible = (el) => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const all = [...document.querySelectorAll('main *'), ...document.querySelectorAll('body > div:not(#root) *')];
  const out = [];
  for (const el of [document.scrollingElement, ...all]) {
    if (!el || !visible(el)) continue;
    const cs = getComputedStyle(el);
    if ((el === document.scrollingElement || /auto|scroll/.test(cs.overflowX)) && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && !el.matches(INTENTIONAL)) {
      out.push(`scrolls sideways: ${name(el)} ${el.scrollWidth}/${el.clientWidth}`);
    }
  }
  const reported = [];
  for (const el of all) {
    if (!visible(el) || el.closest(INTENTIONAL) || reported.some((p) => p.contains(el))) continue;
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    if (b.right > W + 0.5 || b.left < -0.5) {
      out.push(`past edge: ${name(el)} [${Math.round(b.left)}..${Math.round(b.right)}]`);
      reported.push(el);
    }
  }
  return out.slice(0, 10);
};

(async () => {
  const scale = (await getJson('http://127.0.0.1:9339/status'))?.scale || 1;
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  await page.bringToFront();
  const cdp = await page.createCDPSession();
  const tapEl = async (selector, index = 0) => {
    const pt = await page.evaluate(async (sel, idx) => {
      const els = [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      const el = els[idx];
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 250));
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, selector, index);
    if (!pt) return false;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x * scale, y: pt.y * scale }] });
    await sleep(50);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(700);
    return true;
  };
  const count = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getBoundingClientRect().width > 0).length, sel);
  const report = async (state) => {
    const issues = await page.evaluate(SCAN);
    console.log(`[${LABEL}] ${state}: ${issues.length ? issues.join(' | ') : 'ok'}`);
  };
  const scanDropdowns = async (state) => {
    const n = await count('.ma-dropdown-trigger');
    for (let i = 0; i < n; i++) {
      if (!(await tapEl('.ma-dropdown-trigger', i))) continue;
      await report(`${state} · dropdown ${i + 1}/${n} open`);
      await tapEl('.ma-dropdown-trigger', i);
    }
  };

  if (new URL(page.url()).pathname !== '/models-settings') {
    await page.evaluate(() => { history.pushState({}, '', '/models-settings'); dispatchEvent(new PopStateEvent('popstate')); });
    await sleep(2500);
  }
  for (let guard = 0; guard < 3 && await count('.ma-back-button'); guard++) await tapEl('.ma-back-button');
  await report('overview');
  await scanDropdowns('overview');
  const providers = await count('.ma-provider-row');
  for (let i = 0; i < providers; i++) {
    await tapEl('.ma-provider-row', i);
    await report(`provider ${i + 1}/${providers}`);
    await scanDropdowns(`provider ${i + 1}`);
    if (await tapEl('.ma-expander-trigger')) {
      await report(`provider ${i + 1} · custom model open`);
      await scanDropdowns(`provider ${i + 1} · custom model`);
      await tapEl('.ma-expander-trigger');
    }
    await tapEl('.ma-back-button');
  }
  await cdp.detach();
  browser.disconnect();
})();
