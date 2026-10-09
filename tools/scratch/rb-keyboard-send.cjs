/*
 * With the narrow take-over's keyboard bar open (rb-focus-check.cjs leaves it so): text typed in
 * the bar reaches the page's focused field by the send button and by Enter, and backspace deletes
 * there. Reads the page's field after each step.
 *   node tools/scratch/rb-keyboard-send.cjs
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
  const frame = page.frames().find((f) => /\.wb\.localhost/.test(f.url()));
  const pageField = () => frame.evaluate(() => {
    const el = document.querySelector('input[name="search"]');
    return { value: el?.value ?? null, focusedInPage: document.activeElement === el };
  });
  const barValue = () => page.evaluate(() => document.querySelector('.spark-remote-browser__keyboard-input')?.value ?? null);
  if (!(await page.$('.spark-remote-browser__keyboard'))) throw new Error('open the keyboard bar first (rb-focus-check.cjs)');

  console.log('start:', JSON.stringify(await pageField()), 'bar:', JSON.stringify(await barValue()));
  await page.focus('.spark-remote-browser__keyboard-input');
  await cdp.send('Input.insertText', { text: 'Alan Turing' });
  await sleep(200);
  console.log('typed in the bar:', JSON.stringify(await barValue()), 'page:', JSON.stringify(await pageField()));
  await tap('.spark-remote-browser__keyboard-button[aria-label="Send text to the page"]');
  await sleep(900);
  console.log('after send:', JSON.stringify(await pageField()), 'bar:', JSON.stringify(await barValue()));
  await tap('.spark-remote-browser__keyboard-button[aria-label="Send backspace"]');
  await sleep(700);
  console.log('after backspace:', JSON.stringify(await pageField()));
  await page.focus('.spark-remote-browser__keyboard-input');
  await cdp.send('Input.insertText', { text: 'g' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(900);
  console.log('after Enter in the bar:', JSON.stringify(await pageField()), 'bar:', JSON.stringify(await barValue()));
  await cdp.detach();
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
