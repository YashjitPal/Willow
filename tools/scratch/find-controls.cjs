/**
 * Lists visible buttons/links in a tab whose class, aria-label or text matches a pattern,
 * with a selector-ish path and box. Read-only.
 *
 *   node tools/scratch/find-controls.cjs gemini|willow "<regex>"
 */
const puppeteer = require('puppeteer-core');

const ORIGINS = { gemini: 'https://gemini.google.com', willow: 'http://localhost:3000' };

(async () => {
  const [which = 'gemini', pattern = '.'] = process.argv.slice(2);
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith(ORIGINS[which]));
  if (!page) throw new Error(`no ${which} tab`);
  const rows = await page.evaluate((src) => {
    const re = new RegExp(src, 'i');
    const r1 = (n) => Math.round(n * 10) / 10;
    return [...document.querySelectorAll('button, a, [role="button"], [role="menuitem"]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const hay = `${el.className} ${el.getAttribute('aria-label') ?? ''} ${(el.textContent ?? '').trim().slice(0, 80)}`;
        return re.test(hay);
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        const host = el.closest('[class]')?.parentElement?.closest('*:not(div):not(span):not(button)');
        return `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).slice(0, 4).join('.')} ` +
          `aria="${el.getAttribute('aria-label') ?? ''}" text="${(el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50)}" ` +
          `[${[r.x, r.y, r.width, r.height].map(r1)}] in <${host?.tagName.toLowerCase() ?? '?'}>`;
      });
  }, pattern);
  console.log(rows.join('\n') || '(none)');
  browser.disconnect();
})();
