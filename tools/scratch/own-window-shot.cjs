// Screenshot of a marked own-window tab (own-window.cjs), and the first links and conversation rows on it.
//   node tools/scratch/own-window-shot.cjs <marker> <out.png>
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

(async () => {
  const [marker, out] = process.argv.slice(2);
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const target = browser.targets().find((t) => t.type() === 'page' && t.url().includes(`#${marker}`));
  if (!target) throw new Error(`no window marked #${marker}`);
  const page = await target.page();
  await page.bringToFront();
  const cdp = await page.createCDPSession();
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(data, 'base64'));
  console.log(JSON.stringify(await page.evaluate(() => ({
    url: location.href,
    viewport: `${innerWidth}x${innerHeight}`,
    rows: [...document.querySelectorAll('[data-test-id="conversation"], .conversation, a.mat-mdc-list-item, side-nav-entry-button, conversations-list a, conversations-list [role="button"]')]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .slice(0, 12)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.getAttribute('href') || ''} ${(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50)}`),
  }), null, 1)));
  await cdp.detach();
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
