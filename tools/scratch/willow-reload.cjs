/**
 * Reloads the debug Chrome's Willow tab, so every module runs from a fresh load
 * rather than a hot update the test scripts cannot find on the resource timeline.
 *
 *   node tools/scratch/willow-reload.cjs
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  if (!page) throw new Error('no willow tab');
  await page.reload({ waitUntil: 'load', timeout: 60_000 });
  await new Promise((resolve) => setTimeout(resolve, 3000));
  console.log(JSON.stringify({ reloaded: page.url() }));
  browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
