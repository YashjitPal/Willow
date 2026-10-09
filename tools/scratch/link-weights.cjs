/**
 * Tally of Gemini reply link weights, split by whether the link sits inside <b>/<strong>.
 *
 *   node tools/scratch/link-weights.cjs
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith('https://gemini.google.com'));
  const out = await page.evaluate(() => {
    const tally = {};
    for (const a of document.querySelectorAll('message-content a[href]')) {
      const bold = a.closest('b, strong') ? 'in-bold' : 'plain';
      const own = a.querySelector('b, strong') ? '+child-bold' : '';
      const key = `${bold}${own} w${getComputedStyle(a).fontWeight}`;
      tally[key] = (tally[key] || 0) + 1;
    }
    return tally;
  });
  console.log(JSON.stringify(out));
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
