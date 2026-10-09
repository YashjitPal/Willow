/**
 * Real-mouse-clicks a trigger on the Willow tab and watches for a selector over time,
 * then presses Escape. Debugs popups that fail to open or close at once.
 *
 *   node tools/scratch/click-watch.cjs "<trigger>" "<watch selector>"
 */
const puppeteer = require('puppeteer-core');

const [trigger, watch] = process.argv.slice(2);

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const willow = (await browser.pages()).find((p) => (p.url().startsWith('http://localhost:3000') && !p.url().includes('/media')));
  await willow.bringToFront();
  const el = await willow.$(trigger);
  const r = await el.boundingBox();
  console.log('box', JSON.stringify(r));
  console.log('at point', await willow.evaluate((x, y) => document.elementFromPoint(x, y)?.outerHTML.slice(0, 160), r.x + r.width / 2, r.y + r.height / 2));
  await willow.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
  for (const t of [50, 200, 600]) {
    await new Promise((res) => setTimeout(res, t));
    console.log(t, await willow.evaluate((sel, trig) => {
      const m = document.querySelector(sel);
      return `${m ? `${m.className} ${JSON.stringify(m.getBoundingClientRect())}` : 'none'} expanded=${document.querySelector(trig)?.getAttribute('aria-expanded')}`;
    }, watch, trigger));
  }
  await willow.keyboard.press('Escape');
  browser.disconnect();
})();
