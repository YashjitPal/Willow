/*
 * The narrow take-over's keyboard bar, end to end in the Willow test window (phone emulation by
 * rb-emulator.cjs, a taken-over seeded task): the page goes to Wikipedia's search, its field takes
 * focus as a tap would give it, then "Keyboard" opens the bar, text is sent, backspace deletes,
 * and "Hide keyboard" closes the bar. The page's field is read after each step.
 *
 *   node tools/scratch/rb-keyboard-check.cjs [task-id]
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const puppeteer = require('puppeteer-core');

const WILLOW = process.env.WILLOW_URL || 'http://localhost:3101';
const OUT = 'tools/ui-research/captures/spark/134-remote-browser/narrow-takeover/willow';
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
  if (!target) throw new Error(`no Willow tab at ${WILLOW}`);
  const page = await target.page();
  await page.bringToFront();
  const cdp = await page.createCDPSession();
  const scale = (await status())?.scale || 1;
  const tap = async (selector) => {
    const box = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, selector);
    if (!box) throw new Error(`nothing at ${selector}`);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x * scale, y: box.y * scale }] });
    await sleep(70);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(500);
  };
  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  };
  const remote = () => page.frames().find((frame) => /\.wb\.localhost/.test(frame.url()));

  // The page's own navigation, through the app's frames module.
  await page.evaluate(async (id) => {
    const store = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /\/remote-browser\/remote-browser-store\.ts(\?|$)/.test(n)).pop();
    const source = await (await fetch(store)).text();
    const framesUrl = new URL(/["']([^"']*\/remote-browser-frames\.ts(?:\?[^"']*)?)["']/.exec(source)[1], store).href;
    const frames = await import(framesUrl);
    frames.navigateRemoteFrame(id, 'https://en.wikipedia.org/wiki/Special:Search');
  }, taskId);
  for (let i = 0; i < 60 && !(await remote()?.$('input[name="search"]').catch(() => null)); i += 1) await sleep(500);
  const frame = remote();
  if (!frame) throw new Error('the remote frame did not load');
  await frame.evaluate(() => {
    const input = [...document.querySelectorAll('input[name="search"]')].find((el) => el.getBoundingClientRect().width > 0) || document.querySelector('input[name="search"]');
    input.focus();
    input.value = '';
  });
  const field = () => frame.evaluate(() => ({ value: document.activeElement?.value ?? null, tag: document.activeElement?.tagName }));
  console.log('page field focused:', JSON.stringify(await field()));

  await tap('.spark-remote-browser__control[aria-label="Keyboard"]');
  await sleep(400);
  console.log('bar open:', JSON.stringify(await page.evaluate(() => ({
    bar: !!document.querySelector('.spark-remote-browser__keyboard'),
    focused: document.activeElement?.getAttribute('aria-label') ?? null,
    controls: !!document.querySelector('.spark-remote-browser__control-bar'),
    box: (() => { const r = document.querySelector('.spark-remote-browser__keyboard')?.getBoundingClientRect(); return r ? [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10) : null; })(),
  }))));
  await shot('phone-keyboard-new');

  await cdp.send('Input.insertText', { text: 'Alan Turing' });
  await sleep(200);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(900);
  console.log('after Enter:', JSON.stringify(await field()), 'bar text:', JSON.stringify(await page.evaluate(() => document.querySelector('.spark-remote-browser__keyboard-input')?.value)));

  await tap('.spark-remote-browser__keyboard-button[aria-label="Send backspace"]');
  await sleep(700);
  console.log('after backspace:', JSON.stringify(await field()));

  await page.focus('.spark-remote-browser__keyboard-input');
  await cdp.send('Input.insertText', { text: 'g!' });
  await tap('.spark-remote-browser__keyboard-button[aria-label="Send text to the page"]');
  await sleep(900);
  console.log('after send button:', JSON.stringify(await field()));

  await tap('.spark-remote-browser__keyboard-button[aria-label="Hide keyboard"]');
  await sleep(500);
  console.log('bar closed:', JSON.stringify(await page.evaluate(() => ({
    bar: !!document.querySelector('.spark-remote-browser__keyboard'),
    controls: !!document.querySelector('.spark-remote-browser__control-bar'),
  }))));
  await shot('phone-keyboard-hidden-new');
  await cdp.detach();
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
