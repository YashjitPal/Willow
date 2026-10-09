const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  const out = await page.evaluate(async () => {
    const storeUrl = performance.getEntriesByType('resource').filter((e) => /\/spark-store\.ts(\?|$)/.test(e.name)).sort((a, b) => b.startTime - a.startTime)[0]?.name;
    const framesUrl = storeUrl.replace(/spark-store\.ts(\?.*)?$/, 'remote-browser/remote-browser-frames.ts');
    const frames = await import(framesUrl);
    const iframes = [...document.querySelectorAll('iframe')].map((f) => ({ cls: f.className, src: (f.getAttribute('src') || '').slice(0, 80), parent: f.parentElement?.className?.slice?.(0, 60), connected: f.isConnected, hasWindow: Boolean(f.contentWindow) }));
    const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /remote-browser/.test(n));
    return { storeUrl, framesUrl, has: frames.hasRemoteFrame('seed-rb-answered'), iframes, resourceUrls: urls, total: performance.getEntriesByType('resource').length };
  });
  console.log(JSON.stringify(out, null, 1));
  browser.disconnect();
})();
