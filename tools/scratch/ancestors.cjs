/*
 * Prints the ancestor chain of the first element matching a selector in the debug Chrome's
 * Gemini or Willow tab: box, overflow, scrollbar-gutter, padding and width per level.
 *
 *   node tools/scratch/ancestors.cjs gemini|willow "<selector>"
 */
const puppeteer = require('puppeteer-core');

const URLS = { gemini: 'https://gemini.google.com/', willow: 'http://localhost:3000' };

(async () => {
  const [app, selector] = process.argv.slice(2);
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((candidate) => candidate.url().startsWith(URLS[app]));
  const chain = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return [`no element for ${sel}`];
    const out = [];
    for (let n = el; n; n = n.parentElement) {
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      const cls = typeof n.className === 'string' ? n.className.trim().split(/\s+/).slice(0, 4).join('.') : '';
      out.push(`${n.tagName.toLowerCase()}${cls ? `.${cls}` : ''} [${[r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(',')}] ovf ${cs.overflowX}/${cs.overflowY} gutter ${cs.scrollbarGutter} pad ${cs.paddingLeft}/${cs.paddingRight} client ${n.clientWidth} offset ${n.offsetWidth}`);
    }
    return out;
  }, selector);
  console.log(chain.join('\n'));
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
