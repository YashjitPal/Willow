// One-off: closes the debug Chrome's tabs on the :3101 test origin (and nothing else).
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const tabs = (await browser.pages()).filter((p) => /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):3101\//.test(p.url()));
  for (const p of tabs) {
    console.log('closing', p.url());
    await p.close();
  }
  console.log('closed', tabs.length);
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
