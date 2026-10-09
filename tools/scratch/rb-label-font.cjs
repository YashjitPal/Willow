const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  const out = await page.evaluate(() => [...document.querySelectorAll('.spark-remote-browser__take-over > span:last-child')].map((el) => {
    const cs = getComputedStyle(el);
    return { ff: cs.fontFamily, fs: cs.fontSize, fw: cs.fontWeight, fvs: cs.fontVariationSettings, ls: cs.letterSpacing, w: el.getBoundingClientRect().width };
  }));
  console.log('willow', JSON.stringify(out));
  browser.disconnect();
})();
