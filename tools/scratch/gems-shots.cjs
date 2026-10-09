/**
 * Screenshots Gemini and Willow (the Gems tab, never the media tab) side by side at the
 * current emulator size. Optionally routes Willow first (pushState, no reload).
 *
 *   node tools/scratch/gems-shots.cjs [--willow-path=/gems] [--name=prefix]
 */
const puppeteer = require('puppeteer-core');

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const pages = await browser.pages();
  const gemini = pages.find((p) => p.url().startsWith('https://gemini.google.com'));
  const willow = pages.find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  const path = arg('willow-path', null);
  const name = arg('name', 'shot');
  if (path) {
    await willow.evaluate((to) => { history.pushState({}, '', to); dispatchEvent(new PopStateEvent('popstate')); }, path);
  }
  for (const [label, page] of [['g', gemini], ['w', willow]]) {
    await page.bringToFront();
    await new Promise((r) => setTimeout(r, 1200));
    await page.screenshot({ path: `${process.env.TEMP}/${name}-${label}.png` });
    console.log(label, page.url(), await page.evaluate(() => `${innerWidth}x${innerHeight}`));
  }
  browser.disconnect();
})();
