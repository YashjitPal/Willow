/*
 * Dumps every visible row of an open menu in the Gemini or Willow tab: its box, the label's
 * glyph box, type and colour, and each icon's box, size, axes and colour. Use it to diff the
 * same menu in both apps row by row.
 *
 *   node tools/scratch/menu-rows.cjs gemini|willow "<surface selector>" ["<row selector>"]
 */
const puppeteer = require('puppeteer-core');

const URLS = { gemini: 'https://gemini.google.com/', willow: 'http://localhost:3000' };
const ROWS = {
  gemini: 'gem-menu-item, mat-divider, personalization-toggle',
  willow: '[role="menuitem"], [role="menuitemcheckbox"], [aria-haspopup="menu"], [role="separator"], button[aria-label^="Close "]',
};

(async () => {
  const [app, surfaceSel, rowSel] = process.argv.slice(2);
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((candidate) => candidate.url().startsWith(URLS[app]));
  const out = await page.evaluate((sSel, rSel) => {
    const r2 = (n) => Math.round(n * 10) / 10;
    const box = (r) => [r.x, r.y, r.width, r.height].map(r2).join(',');
    const lines = [];
    for (const surface of document.querySelectorAll(sSel)) {
      const sr = surface.getBoundingClientRect();
      if (!sr.width) continue;
      const cs = getComputedStyle(surface);
      lines.push(`SURFACE ${surface.tagName.toLowerCase()} [${box(sr)}] bg ${cs.backgroundColor} r ${cs.borderRadius} pad ${cs.padding} border ${cs.borderTopWidth}/${cs.borderLeftWidth} maxH ${cs.maxHeight} origin ${cs.transformOrigin} anim ${cs.animationName} ${cs.animationDuration}`);
      for (const row of surface.querySelectorAll(rSel)) {
        const rr = row.getBoundingClientRect();
        if (!rr.width) continue;
        if (row.parentElement && row.parentElement.closest(rSel) && row.parentElement.closest(rSel) !== row && surface.contains(row.parentElement.closest(rSel))) continue;
        const rcs = getComputedStyle(row);
        if (row.matches('mat-divider, [role="separator"]')) {
          lines.push(`  divider [${box(rr)}] ${rcs.borderTopWidth} ${rcs.borderTopColor} margin ${rcs.marginTop}/${rcs.marginBottom}`);
          continue;
        }
        const textLeaf = [...row.querySelectorAll('*')].find((c) => [...c.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && !/symbols|mat-icon/i.test(String(c.className)) && !/Symbols/.test(getComputedStyle(c).fontFamily));
        let label = '';
        if (textLeaf) {
          const range = document.createRange();
          range.selectNodeContents(textLeaf);
          const lcs = getComputedStyle(textLeaf);
          label = `"${textLeaf.textContent.trim()}" glyphs [${box(range.getBoundingClientRect())}] ${lcs.fontSize}/${lcs.lineHeight} w${lcs.fontWeight} ${lcs.fontVariationSettings} ${lcs.color}`;
        }
        const icons = [...row.querySelectorAll('mat-icon, .luminous-symbols, .google-symbols, svg, span[style*="mask"]')]
          .filter((i) => i.getBoundingClientRect().width > 0 && !(i.tagName === 'svg' && i.closest('mat-icon')))
          .map((i) => {
            const ics = getComputedStyle(i);
            const name = i.getAttribute('fonticon') || (i.tagName === 'svg' ? 'svg' : (i.textContent || '').trim()) || 'mask';
            return `${name} [${box(i.getBoundingClientRect())}] ${ics.fontSize} ${ics.fontVariationSettings === 'normal' ? '' : ics.fontVariationSettings} ${ics.color}`;
          });
        lines.push(`  row [${box(rr)}] pad ${rcs.paddingTop} ${rcs.paddingRight} ${rcs.paddingBottom} ${rcs.paddingLeft} r ${rcs.borderRadius} | ${label}`);
        for (const icon of icons) lines.push(`      icon ${icon}`);
      }
    }
    return lines.join('\n');
  }, surfaceSel, rowSel || ROWS[app]);
  console.log(out || 'nothing visible');
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
