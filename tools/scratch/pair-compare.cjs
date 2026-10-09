/**
 * Side-by-side boxes and type for pairs of selectors, Gemini first, Willow second, so two
 * different DOMs can be compared part by part. First visible match per selector. Read-only.
 *
 *   node tools/scratch/pair-compare.cjs "<label>|<gemini sel>|<willow sel>" ...
 */
const puppeteer = require('puppeteer-core');

const measure = (page, selectors) => page.evaluate((list) => list.map((sel) => {
  const el = [...document.querySelectorAll(sel)].find((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const r1 = (n) => Math.round(n * 10) / 10;
  return {
    box: [r.x, r.y, r.width, r.height].map(r1).join(','),
    type: `${cs.fontSize}/${cs.lineHeight} w${cs.fontWeight} ${cs.color}`,
    fvs: cs.fontVariationSettings,
    bg: cs.backgroundColor,
    radius: cs.borderRadius,
  };
}), selectors);

(async () => {
  const pairs = process.argv.slice(2).map((arg) => arg.split('|'));
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const pages = await browser.pages();
  const gemini = pages.find((p) => p.url().startsWith('https://gemini.google.com'));
  const willow = pages.find((p) => (p.url().startsWith('http://localhost:3000') && !p.url().includes('/media')));
  const g = await measure(gemini, pairs.map((p) => p[1]));
  const w = await measure(willow, pairs.map((p) => p[2]));
  pairs.forEach(([label], i) => {
    const a = g[i];
    const b = w[i];
    console.log(`${label}`);
    console.log(`  G ${a ? `[${a.box}] ${a.type} bg ${a.bg} r ${a.radius} fvs ${a.fvs}` : 'none'}`);
    console.log(`  W ${b ? `[${b.box}] ${b.type} bg ${b.bg} r ${b.radius} fvs ${b.fvs}` : 'none'}`);
  });
  browser.disconnect();
})();
