// Which modules matching a pattern the Willow test window has loaded, and where it is.
//   node tools/scratch/rb-modules.cjs "<regex>"
const puppeteer = require('puppeteer-core');

const WILLOW = process.env.WILLOW_URL || 'http://localhost:3101';

(async () => {
  const [pattern = 'remote-browser|SparkTaskDetail|spark-store'] = process.argv.slice(2);
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const target = browser.targets().find((t) => t.type() === 'page' && t.url().startsWith(`${WILLOW}/`));
  if (!target) throw new Error(`no Willow tab at ${WILLOW}`);
  const page = await target.page();
  console.log(JSON.stringify(await page.evaluate((source) => {
    const re = new RegExp(source);
    return {
      at: location.pathname,
      title: document.title,
      detail: !!document.querySelector('.spark-task-detail'),
      modules: performance.getEntriesByType('resource').map((e) => e.name).filter((name) => re.test(name)).map((name) => name.replace(location.origin, '')),
    };
  }, pattern), null, 1));
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
