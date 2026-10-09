/**
 * Taps an element in the Willow tab with a real CDP touch and records, for 1.5s, every
 * pointer / mouse / touch / click event the page receives (type, target, time) and whether a
 * given overlay selector is present at each sample — to see why a tap opens, or fails to keep
 * open, an overlay. Willow only.
 *
 *   node tools/scratch/touch-trace.cjs "<selector>" "<overlay selector>"
 */
const http = require('http');
const puppeteer = require('puppeteer-core');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const getJson = (url) => new Promise((resolve) => {
  http.get(url, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
  }).on('error', () => resolve(null));
});

(async () => {
  const [selector, overlay = '[role="dialog"]'] = process.argv.slice(2);
  const scale = (await getJson('http://127.0.0.1:9339/status'))?.scale || 1;
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000'));
  await page.bringToFront();
  await sleep(300);
  const center = await page.evaluate((sel, over) => {
    const el = [...document.querySelectorAll(sel)].find((x) => x.getBoundingClientRect().width > 0);
    if (!el) return null;
    window.__trace = [];
    const t0 = performance.now();
    const name = (n) => (n && n.nodeType === 1
      ? `${n.tagName.toLowerCase()}${typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`
      : String(n));
    for (const type of ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) {
      document.addEventListener(type, (e) => {
        window.__trace.push(`${Math.round(performance.now() - t0)}ms ${type} -> ${name(e.target)}${e.defaultPrevented ? ' (prevented)' : ''}`);
      }, true);
    }
    const sample = () => {
      window.__trace.push(`${Math.round(performance.now() - t0)}ms overlay ${document.querySelector(over) ? 'present' : 'absent'}`);
    };
    for (const ms of [30, 120, 300, 700, 1400]) setTimeout(sample, ms);
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector, overlay);
  if (!center) throw new Error(`no visible ${selector}`);
  const cdp = await page.createCDPSession();
  const point = { x: center.x * scale, y: center.y * scale };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await sleep(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(1600);
  console.log((await page.evaluate(() => window.__trace)).join('\n'));
  await cdp.detach();
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
