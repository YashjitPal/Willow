/*
 * Prints box and type for the first visible match of each selector inside a root, in the
 * Gemini or Willow tab — for comparing rendered markdown (paragraphs, headings, list items,
 * code, links) element by element.
 *
 *   node tools/scratch/md-styles.cjs gemini|willow "<root>" "<sel>" ["<sel>" ...]
 */
const puppeteer = require('puppeteer-core');

const URLS = { gemini: 'https://gemini.google.com/', willow: 'http://localhost:3000' };

(async () => {
  const [app, root, ...selectors] = process.argv.slice(2);
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((candidate) => candidate.url().startsWith(URLS[app]));
  const out = await page.evaluate((rootSel, sels) => {
    const r2 = (n) => Math.round(n * 10) / 10;
    const scope = [...document.querySelectorAll(rootSel)].find((el) => el.getBoundingClientRect().width > 0);
    if (!scope) return `no root ${rootSel}`;
    return sels.map((sel) => {
      const el = [...scope.querySelectorAll(sel)].find((candidate) => candidate.getBoundingClientRect().width > 0);
      if (!el) return `${sel}: none`;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      let glyph = '';
      const text = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      if (text) {
        const range = document.createRange();
        range.selectNodeContents(text);
        const g = range.getClientRects()[0];
        if (g) glyph = ` glyph@${r2(g.x)},${r2(g.y)}`;
      }
      return `${sel}: [${[r.x, r.y, r.width, r.height].map(r2)}]${glyph} ${cs.fontSize}/${cs.lineHeight} w${cs.fontWeight} ${cs.fontVariationSettings} ${cs.color} mar ${cs.margin} pad ${cs.padding} ff ${cs.fontFamily.split(',')[0]}`;
    }).join('\n');
  }, root, selectors);
  console.log(out);
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
