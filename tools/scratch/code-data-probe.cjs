/**
 * Willow (never the media tab): counts what the Code tab has to open — project registry
 * entries by kind, and whether each code project has files stored — without printing any
 * names or content. Read-only.
 *
 *   node tools/scratch/code-data-probe.cjs
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  const out = await page.evaluate(async () => {
    const lines = [];
    const keys = Object.keys(localStorage);
    lines.push(`localStorage keys mentioning project: ${keys.filter((k) => /project/i.test(k)).join(', ') || 'none'}`);
    for (const key of keys.filter((k) => /project/i.test(k))) {
      try {
        const value = JSON.parse(localStorage.getItem(key));
        if (Array.isArray(value)) {
          const kinds = {};
          for (const p of value) kinds[p?.kind ?? 'none'] = (kinds[p?.kind ?? 'none'] || 0) + 1;
          lines.push(`${key}: ${value.length} entries by kind ${JSON.stringify(kinds)}; code ids ${value.filter((p) => p?.kind === 'code').map((p) => p.id).slice(0, 8).join(' ')}`);
          const sample = value.find((p) => p?.kind === 'code');
          if (sample) lines.push(`  code entry fields: ${Object.keys(sample).join(', ')}`);
        } else {
          lines.push(`${key}: ${typeof value}`);
        }
      } catch {
        lines.push(`${key}: not JSON (${(localStorage.getItem(key) || '').length} chars)`);
      }
    }
    const dbs = indexedDB.databases ? await indexedDB.databases() : [];
    lines.push(`indexedDB: ${dbs.map((d) => d.name).join(', ')}`);
    return lines.join('\n');
  });
  console.log(out);
  browser.disconnect();
})();
