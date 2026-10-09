// Read-only: the seed fixtures (seed-rb-*) in a Willow tab's Spark store, with when each was made.
//   WILLOW_URL=http://localhost:3000 node tools/scratch/rb-seed-check.cjs
const puppeteer = require('puppeteer-core');

const WILLOW = process.env.WILLOW_URL;
if (!WILLOW) throw new Error('set WILLOW_URL to the origin to read');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const target = browser.targets().find((t) => t.type() === 'page' && t.url().startsWith(`${WILLOW}/`));
  if (!target) throw new Error(`no Willow tab at ${WILLOW}`);
  const page = await target.page();
  console.log(JSON.stringify(await page.evaluate(async () => {
    const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /\/spark-store\.ts(\?|$)/.test(n));
    if (!urls.length) return { error: 'spark-store not on the timeline' };
    const store = await import(urls[urls.length - 1]);
    const state = store.sparkState.get();
    return {
      at: location.pathname,
      location: state.location,
      taskCount: state.tasks.length,
      fixtures: state.tasks.filter((t) => /^seed-rb-/.test(t.id)).map((t) => ({ id: t.id, title: t.title, createdAt: t.createdAt })),
    };
  }), null, 1));
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
