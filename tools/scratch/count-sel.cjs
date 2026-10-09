/**
 * Every match of a selector in a tab with its box, so a trigger can be picked by index.
 *
 *   node tools/scratch/count-sel.cjs gemini|willow "<selector>"
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const [which = 'gemini', selector] = process.argv.slice(2);
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const prefix = which === 'gemini' ? 'https://gemini.google.com' : 'http://localhost:3000';
  const page = (await browser.pages()).find((p) => p.url().startsWith(prefix));
  const out = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el, i) => {
    const r = el.getBoundingClientRect();
    return `#${i} [${[r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10)}] ${el.closest('top-bar-actions, .top-bar, header, [class*="header"]') ? 'in-header' : ''}`;
  }).join('\n'), selector);
  console.log(out || '(none)');
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
