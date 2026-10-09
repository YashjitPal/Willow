/**
 * Computed box and type styles for a list of selectors in one tab (first visible match each).
 *
 *   node tools/scratch/styles-of.cjs gemini|willow "<sel1>" "<sel2>" ...
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const [which = 'willow', ...selectors] = process.argv.slice(2);
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const prefix = which === 'gemini' ? 'https://gemini.google.com' : 'http://localhost:3000';
  const page = (await browser.pages()).find((p) => p.url().startsWith(prefix));
  if (!page) throw new Error(`no ${which} tab`);
  const rows = await page.evaluate((list) => list.map((sel) => {
    const el = [...document.querySelectorAll(sel)].find((x) => {
      const r = x.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (!el) return `${sel}: (none visible)`;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const round = (n) => Math.round(n * 10) / 10;
    return [
      `${sel}: [${[r.x, r.y, r.width, r.height].map(round).join(',')}]`,
      `  bg ${cs.backgroundColor} | border ${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor} | radius ${cs.borderRadius} | pad ${cs.padding} | mar ${cs.margin}`,
      `  font ${cs.fontSize}/${cs.lineHeight} w${cs.fontWeight} ${cs.color} | fvs ${cs.fontVariationSettings} | family ${cs.fontFamily.split(',')[0]}`,
      `  minH ${cs.minHeight} maxW ${cs.maxWidth} display ${cs.display} gap ${cs.gap} overflow ${cs.overflow}`,
    ].join('\n');
  }), selectors);
  console.log(rows.join('\n'));
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
