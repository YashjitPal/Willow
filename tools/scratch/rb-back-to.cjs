// Steps a Willow tab back through its history, as the browser's Back button does, until its path
// starts with the given prefix. At most 6 steps; stops early if the path stops changing.
//   WILLOW_URL=http://localhost:3000 node tools/scratch/rb-back-to.cjs /spark/dots/
const puppeteer = require('puppeteer-core');

const WILLOW = process.env.WILLOW_URL;
if (!WILLOW) throw new Error('set WILLOW_URL');
const [prefix] = process.argv.slice(2);
if (!prefix) throw new Error('give the path prefix to go back to');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const target = browser.targets().find((t) => t.type() === 'page' && t.url().startsWith(`${WILLOW}/`));
  if (!target) throw new Error(`no Willow tab at ${WILLOW}`);
  const page = await target.page();
  console.log(JSON.stringify(await page.evaluate(async (want) => {
    const steps = [location.pathname];
    for (let i = 0; i < 6 && !location.pathname.startsWith(want); i += 1) {
      const before = location.href;
      history.back();
      await new Promise((resolve) => setTimeout(resolve, 600));
      steps.push(location.pathname);
      if (location.href === before) break;
    }
    return { reached: location.pathname.startsWith(want), steps };
  }, prefix)));
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
