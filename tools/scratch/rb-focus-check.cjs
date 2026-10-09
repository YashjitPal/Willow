/*
 * Where focus is when the narrow take-over's keyboard bar opens, with the page's own field
 * focused first (as a tap in the page leaves it).
 *   node tools/scratch/rb-focus-check.cjs [task-id]
 */
const http = require('http');
const puppeteer = require('puppeteer-core');

const WILLOW = process.env.WILLOW_URL || 'http://localhost:3101';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const status = () => new Promise((resolve) => {
  http.get('http://127.0.0.1:9341/status', (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
  }).on('error', () => resolve(null));
});

(async () => {
  const [taskId = 'seed-rb-answered'] = process.argv.slice(2);
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const target = browser.targets().find((t) => t.type() === 'page' && t.url().startsWith(`${WILLOW}/`));
  const page = await target.page();
  await page.bringToFront();
  const cdp = await page.createCDPSession();
  const scale = (await status())?.scale || 1;
  const tap = async (selector) => {
    const box = await page.evaluate((sel) => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    }, selector);
    if (!box) throw new Error(`nothing at ${selector}`);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x * scale, y: box.y * scale }] });
    await sleep(70);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const where = () => page.evaluate(() => ({
    active: document.activeElement ? `${document.activeElement.tagName}.${String(document.activeElement.className).slice(0, 60)} ${document.activeElement.getAttribute('aria-label') || ''}` : null,
    hasFocus: document.hasFocus(),
    bar: !!document.querySelector('.spark-remote-browser__keyboard'),
  }));
  await page.evaluate(async (id) => {
    const store = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /\/remote-browser\/remote-browser-store\.ts(\?|$)/.test(n)).pop();
    const source = await (await fetch(store)).text();
    const framesUrl = new URL(/["']([^"']*\/remote-browser-frames\.ts(?:\?[^"']*)?)["']/.exec(source)[1], store).href;
    (await import(framesUrl)).navigateRemoteFrame(id, 'https://en.wikipedia.org/wiki/Special:Search');
  }, taskId);
  const remote = () => page.frames().find((frame) => /\.wb\.localhost/.test(frame.url()));
  for (let i = 0; i < 60 && !(await remote()?.$('input[name="search"]').catch(() => null)); i += 1) await sleep(500);
  await remote().evaluate(() => { const el = document.querySelector('input[name="search"]'); el.focus(); el.value = ''; });
  console.log('page field focused:', JSON.stringify(await where()));
  if (await page.$('.spark-remote-browser__keyboard')) await tap('.spark-remote-browser__keyboard-button[aria-label="Hide keyboard"]');
  await sleep(400);
  await tap('.spark-remote-browser__control[aria-label="Keyboard"]');
  for (const ms of [0, 100, 300, 800]) {
    await sleep(ms === 0 ? 30 : ms);
    console.log(`after Keyboard +${ms}ms:`, JSON.stringify(await where()));
  }
  await cdp.detach();
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
