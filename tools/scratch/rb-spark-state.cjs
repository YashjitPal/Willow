// The Spark store as the seeding script sees it in the Willow test window: tasks, location,
// and every spark-store URL on the timeline (a second URL is a second module instance).
//   node tools/scratch/rb-spark-state.cjs
const puppeteer = require('puppeteer-core');

const WILLOW = process.env.WILLOW_URL || 'http://localhost:3101';

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const target = browser.targets().find((t) => t.type() === 'page' && t.url().startsWith(`${WILLOW}/`));
  if (!target) throw new Error(`no Willow tab at ${WILLOW}`);
  const page = await target.page();
  console.log(JSON.stringify(await page.evaluate(async () => {
    const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /spark-store\.ts/.test(n));
    const store = await import(urls[urls.length - 1]);
    const state = store.sparkState.get();
    const workspace = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /SparkWorkspace\.tsx(\?|$)/.test(n));
    const source = workspace ? await (await fetch(workspace)).text() : '';
    const imported = /["']([^"']*spark-store\.ts[^"']*)["']/.exec(source)?.[1] || null;
    return {
      urls: urls.map((u) => u.replace(location.origin, '')),
      importedByWorkspace: imported,
      location: state.location,
      tasks: state.tasks.map((t) => `${t.id} ${t.status}`).slice(0, 8),
      scope: state.scopeId ?? state.scope ?? null,
      keys: Object.keys(state),
    };
  }), null, 1));
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
