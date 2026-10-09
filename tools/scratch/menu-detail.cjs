/**
 * Row-level detail of the open menu in a tab: the panel, each row's box and padding, its
 * glyph (name, box, size, weight, colour) and label (box, type, colour), and any separator.
 * Open the menu first (dom-click-open.cjs); close it afterwards with press-key.cjs.
 *
 *   node tools/scratch/menu-detail.cjs gemini|willow ["<panelSelector>"]
 */
const puppeteer = require('puppeteer-core');

const DEFAULT_PANEL = {
  gemini: '.mat-mdc-menu-panel, gem-menu',
  willow: '[role="menu"]',
};

(async () => {
  const [which = 'gemini', panelArg] = process.argv.slice(2);
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const prefix = which === 'gemini' ? 'https://gemini.google.com' : 'http://localhost:3000';
  const page = (await browser.pages()).find((p) => p.url().startsWith(prefix));
  const out = await page.evaluate((panelSel) => {
    const r1 = (n) => Math.round(n * 10) / 10;
    const box = (el) => { const r = el.getBoundingClientRect(); return `[${[r.x, r.y, r.width, r.height].map(r1).join(',')}]`; };
    const panel = [...document.querySelectorAll(panelSel)].find((el) => el.getBoundingClientRect().width > 0);
    if (!panel) return '(no open menu)';
    const pcs = getComputedStyle(panel);
    const lines = [`panel ${box(panel)} bg ${pcs.backgroundColor} r ${pcs.borderRadius} pad ${pcs.padding} shadow ${pcs.boxShadow} minW ${pcs.minWidth} maxW ${pcs.maxWidth}`];
    const rows = [...panel.querySelectorAll('[role="menuitem"], [role="separator"], hr, mat-divider, .mat-divider, [class*="divider"]')]
      .filter((el, i, all) => el.getBoundingClientRect().height > 0 && !all.some((other) => other !== el && other.contains(el)));
    for (const row of rows) {
      const cs = getComputedStyle(row);
      if (row.matches('[role="separator"], hr, mat-divider, .mat-divider, [class*="divider"]') && !row.matches('[role="menuitem"]')) {
        lines.push(`  separator ${box(row)} bg ${cs.backgroundColor} border-top ${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor} mar ${cs.margin}`);
        continue;
      }
      lines.push(`  row ${box(row)} pad ${cs.padding} r ${cs.borderRadius} gap ${cs.gap} minH ${cs.minHeight}`);
      const icon = row.querySelector('mat-icon, .luminous-symbols, [class*="symbol"]');
      if (icon) {
        const ics = getComputedStyle(icon);
        const inkNode = [...icon.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
        let ink = '';
        if (inkNode) {
          const range = document.createRange();
          range.selectNodeContents(inkNode);
          const g = range.getBoundingClientRect();
          ink = ` text [${[g.x, g.y, g.width, g.height].map(r1).join(',')}]`;
        } else {
          const before = getComputedStyle(icon, '::before');
          if (before.content !== 'none') ink = ` ::before "${before.content}" ${before.width}x${before.height}`;
        }
        lines.push(`    glyph "${icon.getAttribute('fonticon') || icon.dataset?.matIconName || icon.textContent.trim()}" ${box(icon)}${ink} ${ics.fontSize}/${ics.lineHeight} w${ics.fontWeight} ${ics.color} fvs ${ics.fontVariationSettings} mar ${ics.margin} display ${ics.display} align ${ics.textAlign} items ${ics.alignItems} justify ${ics.justifyContent}`);
      }
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent.trim() || (icon && icon.contains(node))) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const glyphBox = range.getBoundingClientRect();
        const lcs = getComputedStyle(node.parentElement);
        lines.push(`    label "${node.textContent.trim()}" text x ${r1(glyphBox.x)} y ${r1(glyphBox.y)} w ${r1(glyphBox.width)} | ${lcs.fontSize}/${lcs.lineHeight} w${lcs.fontWeight} ${lcs.color} fvs ${lcs.fontVariationSettings} ls ${lcs.letterSpacing}`);
        break;
      }
    }
    return lines.join('\n');
  }, panelArg || DEFAULT_PANEL[which]);
  console.log(`${which}:\n${out}`);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
