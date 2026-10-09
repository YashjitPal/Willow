/**
 * Willow (never the media tab): lists the visible sidebar entries whose text matches a
 * pattern, with tag, classes, aria-label and box. Read-only.
 *
 *   node tools/scratch/sidebar-entries.cjs "Code|New chat"
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const pattern = process.argv[2] || 'Code|New chat';
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  const rows = await page.evaluate((src) => {
    const re = new RegExp(src);
    return [...document.querySelectorAll('a, button, [role="button"], [role="link"], div[class*="sidebar-item"]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width && r.height && r.left < 300 && re.test((el.textContent || '').trim());
      })
      .slice(0, 12)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return `${el.tagName.toLowerCase()}.${(typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).slice(0, 4).join('.')} aria=${el.getAttribute('aria-label')} text=${JSON.stringify((el.textContent || '').trim().slice(0, 40))} [${[r.x, r.y, r.width, r.height].map(Math.round)}]`;
      });
  }, pattern);
  console.log(`${page.url()}\n${rows.join('\n')}`);
  browser.disconnect();
})();
