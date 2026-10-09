/**
 * Screenshots a tab's main scroller page by page: finds the tallest scrollable element
 * (or uses the selector given), scrolls it one viewport at a time, and writes
 * %TEMP%\<label>-<n>.png for each step. Restores the scroll position at the end.
 *
 *   node tools/scratch/scroll-shots.cjs gemini|willow <label> ["<scrollerSelector>"] [maxShots=6]
 */
const path = require('path');
const os = require('os');
const puppeteer = require('puppeteer-core');

const ORIGINS = { gemini: 'https://gemini.google.com', willow: 'http://localhost:3000' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const [which = 'gemini', label = 'shot', selector = '', maxArg = '6'] = process.argv.slice(2);
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith(ORIGINS[which]));
  if (!page) throw new Error(`no ${which} tab`);
  await page.bringToFront();
  const info = await page.evaluate((sel) => {
    const candidates = sel ? [document.querySelector(sel)] : [...document.querySelectorAll('*')];
    let best = null;
    for (const el of candidates) {
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (!/(auto|scroll)/.test(cs.overflowY)) continue;
      const extra = el.scrollHeight - el.clientHeight;
      if (extra > 20 && (!best || el.scrollHeight > best.scrollHeight)) best = el;
    }
    if (!best) return null;
    best.setAttribute('data-scroll-shot', '1');
    return { tag: best.tagName.toLowerCase(), cls: String(best.className).slice(0, 80), scrollHeight: best.scrollHeight, clientHeight: best.clientHeight, top: best.scrollTop };
  }, selector);
  if (!info) { console.log('no scroller found'); browser.disconnect(); return; }
  console.log(`scroller <${info.tag}.${info.cls}> ${info.scrollHeight} / ${info.clientHeight}`);
  const steps = Math.min(Number(maxArg), Math.ceil(info.scrollHeight / info.clientHeight));
  for (let i = 0; i < steps; i += 1) {
    await page.evaluate((y) => { document.querySelector('[data-scroll-shot]').scrollTop = y; }, i * (info.clientHeight - 80));
    await sleep(700);
    const file = path.join(os.tmpdir(), `${label}-${i}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
  await page.evaluate((y) => {
    const el = document.querySelector('[data-scroll-shot]');
    el.scrollTop = y;
    el.removeAttribute('data-scroll-shot');
  }, info.top);
  browser.disconnect();
})();
