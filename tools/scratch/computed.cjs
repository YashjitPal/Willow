/*
 * Prints computed values of the named CSS properties for every element matching a selector
 * (first 12) in the debug Chrome's Gemini or Willow tab, optionally for a pseudo-element.
 *
 *   node tools/scratch/computed.cjs gemini|willow "<selector>" prop1 prop2 ... [--pseudo=::before]
 */
const puppeteer = require('puppeteer-core');

const URLS = { gemini: 'https://gemini.google.com/', willow: 'http://localhost:3000' };

(async () => {
  const args = process.argv.slice(2);
  const pseudo = (args.find((a) => a.startsWith('--pseudo=')) || '').slice(9) || null;
  const [app, selector, ...props] = args.filter((a) => !a.startsWith('--'));
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((candidate) => candidate.url().startsWith(URLS[app]));
  const rows = await page.evaluate((sel, names, pseudoEl) => [...document.querySelectorAll(sel)].slice(0, 12).map((el) => {
    const cs = getComputedStyle(el, pseudoEl);
    const r = el.getBoundingClientRect();
    return { box: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10), ...Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n)])) };
  }), selector, props, pseudo);
  for (const row of rows) console.log(JSON.stringify(row));
  if (!rows.length) console.log(`no element for ${selector}`);
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
