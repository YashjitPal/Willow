/**
 * Captures the Willow remote-browser pane's states in the Willow tab: loader, live with
 * the agent's pointer, the hover scrim, history (previous/next, dots, View Live) and
 * take-over. Sets session state through spark-rb-seed.cjs; calls no model.
 *
 *   node tools/scratch/willow-pane-states.cjs <out-dir>
 */
const puppeteer = require('puppeteer-core');
const { execFileSync } = require('child_process');
const path = require('path');

const seed = (...args) => execFileSync('node', ['tools/scratch/spark-rb-seed.cjs', ...args], { encoding: 'utf8' }).trim();

(async () => {
  const out = process.argv[2] || 'tools/ui-research/captures/spark/134-remote-browser/willow';
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  if (!page) throw new Error('no willow tab');
  await page.bringToFront();
  const box = (selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, selector);
  const shot = (name) => page.screenshot({ path: path.join(out, `pane-${name}.png`) });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  await page.mouse.move(30, 700);
  console.log(seed('phase', 'preparing'));
  await wait(700);
  await shot('loader');

  console.log(seed('phase', 'live', '520,262'));
  await wait(600);
  await shot('live-cursor');

  const viewer = await box('.spark-remote-browser__viewer');
  await page.mouse.move(viewer.x + viewer.w / 2, viewer.y + viewer.h / 2, { steps: 5 });
  await wait(450);
  await shot('live-hover');
  const takeOver = await box('.spark-remote-browser__take-over');
  console.log('take over', JSON.stringify(takeOver));

  await page.mouse.move(30, 700);
  console.log(seed('phase', 'idle'));
  console.log(seed('shots', '3'));
  await wait(500);
  await page.mouse.move(viewer.x + viewer.w / 2, viewer.y + viewer.h / 2, { steps: 5 });
  await wait(450);
  await shot('idle-hover-shots');
  const prev = await box('.spark-remote-browser__nav-button');
  await page.mouse.click(prev.x + prev.w / 2, prev.y + prev.h / 2);
  await wait(500);
  await shot('history-last');
  await page.mouse.click(prev.x + prev.w / 2, prev.y + prev.h / 2);
  await wait(300);
  await page.mouse.click(prev.x + prev.w / 2, prev.y + prev.h / 2);
  await wait(500);
  await shot('history-first');
  const dots = await page.evaluate(() => [...document.querySelectorAll('.spark-remote-browser__dot')].map((d) => {
    const r = d.getBoundingClientRect();
    return `${Math.round(r.x)},${Math.round(r.y)} ${r.width}x${r.height}${d.classList.contains('is-active') ? '*' : ''}`;
  }));
  const live = await box('.spark-remote-browser__live-button');
  console.log('dots', JSON.stringify(dots), 'live button', JSON.stringify(live));
  await page.mouse.click(live.x + live.w / 2, live.y + live.h / 2);
  await wait(400);
  await page.mouse.move(30, 700);
  await wait(400);
  await shot('back-live');

  console.log(seed('takeover', 'on'));
  await wait(800);
  await shot('takeover');
  const giveBack = await box('.spark-remote-browser-takeover__give-back');
  const takeoverViewer = await box('.spark-remote-browser-takeover .spark-remote-browser__viewer');
  console.log('give back', JSON.stringify(giveBack), 'takeover viewer', JSON.stringify(takeoverViewer));
  await page.mouse.click(giveBack.x + giveBack.w / 2, giveBack.y + giveBack.h / 2);
  await wait(600);
  await shot('after-give-back');
  console.log(seed('state'));
  browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
