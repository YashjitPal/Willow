/**
 * Whether an overlay really covers the viewport: hit-tests a grid of points and reports any
 * point whose topmost element is outside the overlay.
 *
 *   node tools/scratch/cover-check.cjs gemini|willow "<overlaySelector>"
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const [which = 'willow', selector] = process.argv.slice(2);
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const prefix = which === 'gemini' ? 'https://gemini.google.com' : 'http://localhost:3000';
  const page = (await browser.pages()).find((p) => p.url().startsWith(prefix));
  const out = await page.evaluate((sel) => {
    const overlay = document.querySelector(sel);
    if (!overlay) return `no ${sel}`;
    const misses = [];
    const w = window.innerWidth;
    const h = window.innerHeight;
    let total = 0;
    for (let y = 2; y < h; y += Math.floor(h / 12)) {
      for (let x = 2; x < w; x += Math.floor(w / 6)) {
        total += 1;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !overlay.contains(hit)) {
          misses.push(`(${x},${y}) ${hit ? `<${hit.tagName.toLowerCase()} class="${String(hit.className).slice(0, 50)}">` : 'nothing'}`);
        }
      }
    }
    return `${total - misses.length}/${total} points inside the overlay${misses.length ? `\n${misses.join('\n')}` : ''}`;
  }, selector);
  console.log(out);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
