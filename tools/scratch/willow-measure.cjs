/**
 * Prints boxes (relative to a root element) and key computed styles for elements in the
 * Willow tab, for comparing against Gemini dumps.
 *
 *   node tools/scratch/willow-measure.cjs "<root selector>" "<child selector>" ["<child selector>" ...]
 *   node tools/scratch/willow-measure.cjs ".spark-browser-card" ".spark-browser-card__title" ...
 *
 * A child selector of `@root` reports the root itself, absolutely.
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const [rootSelector, ...children] = process.argv.slice(2);
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  if (!page) throw new Error('no willow tab');
  const rows = await page.evaluate((rootSel, childSels) => {
    const root = document.querySelector(rootSel);
    if (!root) return [`no ${rootSel}`];
    const rr = root.getBoundingClientRect();
    const fmt = (n) => Math.round(n * 10) / 10;
    const out = [`@root ${rootSel} [${fmt(rr.x)},${fmt(rr.y)},${fmt(rr.width)},${fmt(rr.height)}]`];
    for (const sel of childSels) {
      const nodes = sel === '@root' ? [root] : [...root.querySelectorAll(sel)];
      if (!nodes.length) out.push(`  ${sel}: none`);
      nodes.slice(0, 4).forEach((node, index) => {
        const r = node.getBoundingClientRect();
        const cs = getComputedStyle(node);
        const style = [
          `fs=${cs.fontSize}/${cs.lineHeight}`,
          `w=${cs.fontWeight}`,
          `c=${cs.color}`,
          cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? `bg=${cs.backgroundColor}` : '',
          cs.borderRadius !== '0px' ? `r=${cs.borderRadius}` : '',
          cs.padding !== '0px' ? `p=${cs.padding}` : '',
          cs.fontFamily.split(',')[0],
        ].filter(Boolean).join(' ');
        out.push(`  ${sel}${nodes.length > 1 ? `#${index}` : ''} +[${fmt(r.x - rr.x)},${fmt(r.y - rr.y)}] ${fmt(r.width)}x${fmt(r.height)} ${style}`);
      });
    }
    return out;
  }, rootSelector, children);
  console.log(rows.join('\n'));
  browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
