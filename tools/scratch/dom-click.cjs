/**
 * Willow (never the media tab): DOM-clicks the index-th visible element matching a
 * selector (optionally the one whose aria-label or text equals a value), for driving
 * desktop states where touch emulation is off.
 *
 *   node tools/scratch/dom-click.cjs "<selector>" [index] [--label=Text]
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const args = process.argv.slice(2);
  const label = (args.find((a) => a.startsWith('--label=')) || '').slice(8) || null;
  const [selector, index = '0'] = args.filter((a) => !a.startsWith('--'));
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  const result = await page.evaluate((sel, idx, lab) => {
    const els = [...document.querySelectorAll(sel)].filter((e) => {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      if (!lab) return true;
      return e.getAttribute('aria-label') === lab || e.textContent.trim() === lab;
    });
    const el = els[Number(idx)];
    if (!el) return `no match (${els.length} candidates)`;
    el.click();
    return `clicked ${el.tagName.toLowerCase()} (${els.length} candidates)`;
  }, selector, index, label);
  console.log(result);
  await new Promise((r) => setTimeout(r, 1200));
  browser.disconnect();
})();
