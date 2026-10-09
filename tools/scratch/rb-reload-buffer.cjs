/*
 * Reloads this work's Willow window with a resource-timing buffer big enough for every module
 * the app loads. The seeding scripts find the app's own store instances on that timeline, which
 * otherwise stops at 250 entries, before Spark's task modules arrive.
 *
 *   node tools/scratch/rb-reload-buffer.cjs
 */
const puppeteer = require('puppeteer-core');

const WILLOW = process.env.WILLOW_URL || 'http://localhost:3101';

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const target = browser.targets().find((t) => t.type() === 'page' && t.url().startsWith(`${WILLOW}/`));
  if (!target) throw new Error(`no Willow tab at ${WILLOW}`);
  const page = await target.page();
  await page.evaluateOnNewDocument(() => performance.setResourceTimingBufferSize(20000));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('textarea, [contenteditable="true"]').length > 0, { timeout: 120000 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 4000));
  console.log(await page.evaluate(() => `${location.pathname}: ${performance.getEntriesByType('resource').length} resources`));
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
