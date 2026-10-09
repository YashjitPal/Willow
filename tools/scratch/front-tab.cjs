/**
 * Brings one debug-Chrome tab to the front without navigating it: `gemini`, or `willow`
 * (the :3000 tab that is not the user's /media one).
 *
 *   node tools/scratch/front-tab.cjs gemini|willow
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const which = process.argv[2] || 'gemini';
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const match = which === 'gemini'
    ? (u) => u.startsWith('https://gemini.google.com/')
    : (u) => u.startsWith('http://localhost:3000') && !u.includes('/media');
  const page = (await browser.pages()).find((p) => match(p.url()));
  if (!page) throw new Error(`no ${which} tab`);
  await page.bringToFront();
  console.log(`front: ${page.url().slice(0, 80)}`);
  browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
