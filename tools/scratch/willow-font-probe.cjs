const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  const out = await page.evaluate(() => [...document.querySelectorAll('.spark-browser-card__button, .spark-browser-card__button > span, .spark-browser-card__title')].map((el) => {
    const cs = getComputedStyle(el);
    return { cls: el.className, text: el.textContent.trim().slice(0, 20), w: Math.round(el.getBoundingClientRect().width * 10) / 10, fvs: cs.fontVariationSettings, ff: cs.fontFamily.slice(0, 40), fs: cs.fontSize, fw: cs.fontWeight, stretch: cs.fontStretch, ls: cs.letterSpacing };
  }));
  console.log(JSON.stringify(out, null, 1));
  browser.disconnect();
})();
