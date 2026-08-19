/**
 * Gemini's sources surface with several sources in it: the chip's disc order, and the
 * panel that opens from it. Read-only.
 */
const { connect, save, outPath, dumpTree } = require('../ui-research/scrapers/notebooks/lib.cjs');
const fs = require('fs');

const CHIP = `() => {
  const list = document.querySelector('gem-source-list');
  if (!list) return { error: 'no gem-source-list' };
  const chip = document.querySelector('gem-source-list-chip');
  return {
    chipLabel: chip ? chip.getAttribute('aria-label') : null,
    chipRect: chip ? (() => { const r = chip.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width * 10) / 10, h: Math.round(r.height) }; })() : null,
    listClass: list.className,
    discs: Array.from(list.querySelectorAll('.icon-container')).map((d) => {
      const r = d.getBoundingClientRect();
      const cs = getComputedStyle(d);
      const img = d.querySelector('img');
      const svg = d.querySelector('svg, mat-icon');
      return {
        x: Math.round(r.x * 10) / 10,
        w: Math.round(r.width * 10) / 10,
        zIndex: cs.zIndex,
        inlineStyle: d.getAttribute('style'),
        imgSrc: img ? img.getAttribute('src') : null,
        other: !img && svg ? svg.outerHTML.slice(0, 200) : null,
      };
    }),
  };
}`;

/** Whatever panel is open: its rows/cards, with geometry. */
const PANEL = `() => {
  const out = { candidates: [] };
  const dialog = document.querySelector('mat-dialog-container, [role="dialog"]');
  if (!dialog) return { error: 'no dialog open' };
  const dr = dialog.getBoundingClientRect();
  out.dialog = {
    tag: dialog.tagName.toLowerCase(),
    cls: dialog.className,
    rect: { x: Math.round(dr.x), y: Math.round(dr.y), w: Math.round(dr.width * 10) / 10, h: Math.round(dr.height * 10) / 10 },
    styles: (() => { const cs = getComputedStyle(dialog); return { background: cs.backgroundColor, radius: cs.borderRadius, padding: cs.padding }; })(),
  };

  // Anything that repeats and looks like a source entry.
  const groups = {};
  for (const el of dialog.querySelectorAll('*')) {
    const cls = el.className && el.className.toString ? el.className.toString().trim() : '';
    if (!cls) continue;
    const key = el.tagName.toLowerCase() + '.' + cls.split(/\\s+/).slice(0, 2).join('.');
    groups[key] = (groups[key] || 0) + 1;
  }
  out.repeated = Object.entries(groups).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 25);
  return out;
}`;

(async () => {
  const browser = await connect();
  try {
    const page = (await browser.pages()).find((p) => /gemini\.google\.com\/notebook/.test(p.url()));
    if (!page) throw new Error('no Gemini notebook tab');
    console.log(page.url());

    const chip = await page.evaluate(new Function('return ' + CHIP)());
    save('src-chip/gemini-chip-multi.json', chip);
    console.log('\n=== chip');
    console.log(JSON.stringify(chip, null, 2));

    const panel = await page.evaluate(new Function('return ' + PANEL)());
    save('src-chip/gemini-panel-shape.json', panel);
    console.log('\n=== panel');
    console.log(JSON.stringify(panel, null, 2));

    if (!panel.error) {
      const tree = await dumpTree(page, '[role="dialog"]', 14);
      save('src-chip/gemini-panel-tree.json', tree);
      const r = panel.dialog.rect;
      const buf = await page.screenshot({ clip: { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.w + 16, height: r.h + 16 } });
      fs.writeFileSync(outPath('src-chip/gemini-panel.png'), buf);
      console.log('  saved src-chip/gemini-panel.png + tree');
    }
  } finally {
    await browser.disconnect();
  }
})();
