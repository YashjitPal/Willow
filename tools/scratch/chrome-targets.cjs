/**
 * Every target in the debug Chrome by type (pages, workers, extensions), and the proxy view of
 * chrome://net-internals read in this work's window. Read-only; the window ends where it was.
 *
 *   node tools/scratch/chrome-targets.cjs <marker>
 */
const puppeteer = require('puppeteer-core');

const marker = process.argv[2] || 'willow-library-probe';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60_000 });
  const session = await browser.target().createCDPSession();
  const { targetInfos } = await session.send('Target.getTargets');
  const byType = {};
  for (const t of targetInfos) (byType[t.type] ??= []).push(`${t.url.slice(0, 110)}${t.attached ? ' (attached)' : ''}`);
  for (const [type, urls] of Object.entries(byType)) console.log(`${type} (${urls.length}):\n  ${urls.join('\n  ')}`);

  const target = browser.targets().find((t) => t.type() === 'page' && t.url().includes(`#${marker}`));
  if (target) {
    const page = await target.page();
    await page.goto('chrome://net-internals/#proxy');
    await sleep(3000);
    console.log('--- proxy view:', await page.evaluate(() => {
      const view = document.querySelector('#proxy-view-tab-content') || document.querySelector('[id*="proxy"]');
      return (view?.innerText || document.body.innerText).replace(/\s*\n\s*/g, ' | ').slice(0, 800);
    }));
    await page.goto(`about:blank#${marker}`);
  }
  await browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
