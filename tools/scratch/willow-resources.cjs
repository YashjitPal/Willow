const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  const facts = await page.evaluate(() => {
    const entries = performance.getEntriesByType('resource');
    const bad = entries.filter((e) => e.responseStatus >= 400 || (e.responseStatus === 0 && e.transferSize === 0 && e.decodedBodySize === 0)).map((e) => `${e.responseStatus} ${e.name.slice(0, 140)}`);
    const pending = entries.filter((e) => e.duration > 5000).map((e) => `${Math.round(e.duration)}ms ${e.name.slice(0, 140)}`);
    return {
      readyState: document.readyState,
      bodyStart: document.body.innerHTML.slice(0, 600),
      resources: entries.length,
      bad: bad.slice(0, 15),
      slow: pending.slice(0, 10),
      last: entries.slice(-6).map((e) => `${e.responseStatus} ${Math.round(e.duration)}ms ${e.name.slice(0, 140)}`),
    };
  });
  console.log(JSON.stringify(facts, null, 1));
  browser.disconnect();
})();
