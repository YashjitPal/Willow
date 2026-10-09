/*
 * The narrow pane, take-over and keyboard bar in the light theme, in the Willow test window
 * (phone emulation, a seeded open pane): the theme class goes on for the screenshots and comes
 * off again at the end.
 *   node tools/scratch/rb-light-check.cjs
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
    await sleep(600);
  };
  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  };
  try {
    await page.evaluate(() => document.documentElement.classList.add('light-theme'));
    await sleep(400);
    await shot('light-phone-pane');
    await tap('.spark-remote-browser__action.is-tonal');
    await sleep(600);
    await shot('light-phone-takeover');
    await tap('.spark-remote-browser__control[aria-label="Keyboard"]');
    await sleep(500);
    await shot('light-phone-keyboard');
    await tap('.spark-remote-browser__keyboard-button[aria-label="Hide keyboard"]');
    await tap('.spark-remote-browser-takeover__give-back');
    console.log('light shots saved');
  } finally {
    await page.evaluate(() => document.documentElement.classList.remove('light-theme'));
    await cdp.detach();
    await browser.disconnect();
  }
})().catch((e) => { console.error(e); process.exit(1); });
