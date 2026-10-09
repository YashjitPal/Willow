/**
 * How the Spark header's beta badge renders: source text, text-transform, glyph width.
 *
 *   node tools/scratch/badge-text.cjs gemini|willow
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const which = process.argv[2] || 'gemini';
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const prefix = which === 'gemini' ? 'https://gemini.google.com' : 'http://localhost:3000';
  const page = (await browser.pages()).find((p) => p.url().startsWith(prefix));
  const out = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const rows = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!/^\s*beta\s*$/i.test(node.textContent)) continue;
      const el = node.parentElement;
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const glyph = range.getBoundingClientRect();
      const cs = getComputedStyle(el);
      rows.push(`"${node.textContent.trim()}" <${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 60)}"> transform ${cs.textTransform} | glyph w ${Math.round(glyph.width * 10) / 10} x ${Math.round(glyph.x * 10) / 10} | ${cs.fontSize} w${cs.fontWeight} ls ${cs.letterSpacing} fvs ${cs.fontVariationSettings}`);
    }
    return rows.join('\n') || '(none)';
  });
  console.log(`${which}:\n${out}`);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
