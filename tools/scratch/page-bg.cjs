/**
 * The colour actually painted behind a few blank points of the current page (the first
 * non-transparent background in the hit-test stack), for the Gemini or Willow tab.
 *
 *   node tools/scratch/page-bg.cjs gemini|willow
 */
const puppeteer = require('puppeteer-core');

const ORIGINS = { gemini: 'https://gemini.google.com', willow: 'http://localhost:3000' };

(async () => {
  const which = process.argv[2] || 'gemini';
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith(ORIGINS[which]));
  const out = await page.evaluate(() => {
    const points = [[4, 300], [innerWidth - 4, innerHeight - 4], [innerWidth / 2, 62], [4, innerHeight - 4]];
    return points.map(([x, y]) => {
      const stack = document.elementsFromPoint(x, y);
      const painted = stack.find((el) => {
        const bg = getComputedStyle(el).backgroundColor;
        return bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      }) || document.documentElement;
      const cls = typeof painted.className === 'string' ? painted.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      return `(${Math.round(x)},${Math.round(y)}) ${getComputedStyle(painted).backgroundColor} on ${painted.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
    }).join(' | ');
  });
  console.log(`${which} ${page.url().replace(/^https?:\/\/[^/]+/, '')}: ${out}`);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
