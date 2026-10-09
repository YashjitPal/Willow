/**
 * Willow (never the media tab): prints the workbench top bar's tab strip, its tabs, the
 * Add tool button and the right-hand group as [left, right] boxes, plus the strip's
 * scroll state, to show whether the tabs fit or scroll and whether anything overlaps.
 *
 *   node tools/scratch/code-topbar-measure.cjs
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  const result = await page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.right)];
    };
    const strip = document.querySelector('.code-topbar-tabs');
    return {
      viewport: innerWidth,
      strip: box(strip),
      scroll: strip && { left: Math.round(strip.scrollLeft), width: strip.scrollWidth, client: strip.clientWidth },
      tabs: [...document.querySelectorAll('.code-topbar-tabs > button')].map((b) => [b.getAttribute('aria-label'), b.dataset.active ? 'active' : '', ...box(b)]),
      add: box(document.querySelector('button[aria-label="Add tool"]')),
      right: box(document.querySelector('.code-topbar-right')),
    };
  });
  console.log(JSON.stringify(result));
  browser.disconnect();
})();
