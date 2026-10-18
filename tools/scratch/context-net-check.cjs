// Can a fresh browser context of the debug Chrome reach the internet? Loads one URL in it, no
// interception, and reports the outcome.
//   node tools/scratch/context-net-check.cjs [url]
const puppeteer = require('puppeteer-core');

(async () => {
  const [url = 'https://cdn.tailwindcss.com/'] = process.argv.slice(2);
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    const t0 = Date.now();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => ({ error: e.message }));
    console.log(JSON.stringify({ url, ms: Date.now() - t0, status: response?.status?.() ?? null, error: response?.error ?? null }));
  } finally {
    await context.close();
    browser.disconnect();
  }
})().catch((e) => { console.error(e); process.exit(1); });
