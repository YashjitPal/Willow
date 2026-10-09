// Read-only: evaluates an expression in the #willow-probe Flow tab and prints the JSON result.
//   node tools/scratch/flow-eval.cjs "<expression>"
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  // Flow tabs only: other agents' tabs (Gemini Spark's) carry #willow-probe too.
  const page = (await browser.pages()).find((p) => p.url().includes('#willow-probe') && p.url().includes('flow.google.com'));
  if (!page) throw new Error('no #willow-probe tab');
  const result = await page.evaluate((src) => {
    // eslint-disable-next-line no-new-func
    const value = new Function(`return (${src});`)();
    return JSON.stringify(value);
  }, process.argv[2]);
  console.log(result);
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
