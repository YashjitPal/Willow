/**
 * Willow /customize (never the media tab), below 961px: opens the first card's actions
 * sheet, closes it from its backdrop, and samples the sheet every animation frame until it
 * leaves the DOM — to confirm its slide-out plays to the end instead of being cut off by
 * the menu unmounting. Opens and closes only.
 *
 *   node tools/scratch/cz-sheet-exit.cjs
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  await page.bringToFront();
  const out = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const more = [...document.querySelectorAll('.customize-card .more-button')].find((b) => b.getBoundingClientRect().width > 0);
    if (!more) return 'no card with a more button on screen';
    more.click();
    await sleep(500);
    const backdrop = document.querySelector('.gemini-bottom-sheet-backdrop');
    if (!backdrop) return 'no sheet opened';
    const t0 = performance.now();
    backdrop.click();
    const frames = [];
    for (;;) {
      await new Promise((r) => requestAnimationFrame(r));
      const t = Math.round(performance.now() - t0);
      const sheet = document.querySelector('.gemini-bottom-sheet');
      const scrim = document.querySelector('.gemini-bottom-sheet-backdrop');
      if (!sheet) { frames.push(`${t}ms gone`); break; }
      const m = new DOMMatrixReadOnly(getComputedStyle(sheet).transform);
      frames.push(`${t}ms y+${Math.round(m.m42)} scrim ${Number(getComputedStyle(scrim).opacity).toFixed(2)}`);
      if (t > 1000) break;
    }
    return frames.join('\n');
  });
  console.log(out);
  browser.disconnect();
})();
