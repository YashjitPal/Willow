/**
 * Read-only: points the Gemini tab at the first conversation linked from its sidebar
 * (`/app/<id>`), so a chat thread's chrome can be measured. Opens; never sends.
 *
 *   node tools/scratch/open-first-chat.cjs
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 60_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith('https://gemini.google.com'));
  const href = await page.evaluate(() => [...document.querySelectorAll('a[href]')]
    .map((a) => a.getAttribute('href'))
    .find((h) => /^\/app\/[0-9a-f]{8,}/.test(h || '')) || null);
  if (!href) throw new Error('no conversation link found');
  await page.goto(`https://gemini.google.com${href}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await new Promise((resolve) => setTimeout(resolve, 5000));
  console.log(page.url());
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
