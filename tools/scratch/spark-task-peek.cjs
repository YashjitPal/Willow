const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  const out = await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/spark-store\.ts(\?|$)/.test(n));
    const store = await import(url);
    const task = store.sparkState.get().tasks.find((t) => t.id === 'seed-rb-pending');
    const keys = Object.keys(localStorage).filter((k) => k.includes('seed-rb-pending') || /^willow:spark:v\d+:/.test(k));
    const records = keys.map((k) => {
      const v = JSON.parse(localStorage.getItem(k) || 'null');
      const t = k.includes('seed-rb-pending') ? v : v?.tasks?.find((x) => x.id === 'seed-rb-pending');
      return { key: k.slice(0, 70), hasRequest: Boolean(t?.browserRequest), status: t?.status, bodyLoaded: t?.bodyLoaded };
    });
    return {
      inStore: task ? { status: task.status, bodyLoaded: task.bodyLoaded, browserRequest: task.browserRequest, keys: Object.keys(task).join(',') } : null,
      records,
      storeUrl: url,
    };
  });
  console.log(JSON.stringify(out, null, 1));
  browser.disconnect();
})();
