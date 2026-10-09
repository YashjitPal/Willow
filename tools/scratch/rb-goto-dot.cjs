// Opens a Dots bot in a Willow tab through the app's own Spark navigation (no reload).
//   WILLOW_URL=http://localhost:3000 node tools/scratch/rb-goto-dot.cjs <dot-id>
const puppeteer = require('puppeteer-core');

const WILLOW = process.env.WILLOW_URL;
if (!WILLOW) throw new Error('set WILLOW_URL');
const [dotId] = process.argv.slice(2);
if (!dotId) throw new Error('give the dot id');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const target = browser.targets().find((t) => t.type() === 'page' && t.url().startsWith(`${WILLOW}/`));
  if (!target) throw new Error(`no Willow tab at ${WILLOW}`);
  const page = await target.page();
  console.log(JSON.stringify(await page.evaluate(async (id) => {
    const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /\/spark-store\.ts(\?|$)/.test(n));
    const store = await import(urls[urls.length - 1]);
    store.goToSparkDot(id);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return { at: location.pathname, location: store.sparkState.get().location };
  }, dotId)));
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
