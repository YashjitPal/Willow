// Screenshot of the Willow test window, and why importing the remote-browser store fails there.
//   node tools/scratch/rb-willow-debug.cjs <out.png>
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const WILLOW = process.env.WILLOW_URL || 'http://localhost:3101';

(async () => {
  const [out = 'tools/ui-research/captures/spark/134-remote-browser/narrow-takeover/willow/debug.png'] = process.argv.slice(2);
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const target = browser.targets().find((t) => t.type() === 'page' && t.url().startsWith(`${WILLOW}/`));
  if (!target) throw new Error(`no Willow tab at ${WILLOW}`);
  const page = await target.page();
  await page.bringToFront();
  console.log(JSON.stringify(await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /\/remote-browser\/remote-browser-store\.ts(\?|$)/.test(n)).pop();
    try {
      const mod = await import(url);
      return { url, exports: Object.keys(mod).slice(0, 12) };
    } catch (error) {
      return { url, error: String(error && error.message || error) };
    }
  })));
  const cdp = await page.createCDPSession();
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(require('path').dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(data, 'base64'));
  console.log('saved', out);
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
