// Read-only: evaluates an expression in the user's localhost:3000 Willow tab in the debug Chrome and
// prints the JSON result. Nothing is clicked, navigated or written.
//   node tools/scratch/willow3000-read.cjs "<expression>"
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const pages = (await browser.pages()).filter((p) => /^http:\/\/localhost:3000\//.test(p.url()));
  for (const page of pages) {
    const result = await page.evaluate((src) => {
      // eslint-disable-next-line no-new-func
      return JSON.stringify(new Function(`return (${src});`)());
    }, process.argv[2]);
    console.log(page.url(), result);
  }
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
