/** Prints every frame in the Willow tab, so a remote-browser error page shows its real URL. */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  for (const frame of page.frames()) {
    let text = '';
    try {
      text = await frame.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 300));
    } catch (error) {
      text = `(${error.message.slice(0, 80)})`;
    }
    console.log(`${frame.url()}\n  ${text}`);
  }
  browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
