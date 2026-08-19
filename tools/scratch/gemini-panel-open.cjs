/**
 * Open Gemini's sources panel from the chip and record it: the source order (needed to
 * tell whether the chip shows the first three or the last three), the card geometry, and
 * a screenshot.
 */
const { connect, save, outPath, sleep, dumpTree } = require('../ui-research/scrapers/notebooks/lib.cjs');
const fs = require('fs');

const SHAPE = `() => {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) return { error: 'no dialog' };
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; };
  const cs = getComputedStyle(dialog);
  const counts = {};
  for (const el of dialog.querySelectorAll('*')) {
    const cls = el.className && el.className.toString ? el.className.toString().trim() : '';
    if (!cls) continue;
    const key = el.tagName.toLowerCase() + '.' + cls.split(/\\s+/).slice(0, 2).join('.');
    (counts[key] = counts[key] || { n: 0, rects: [] });
    counts[key].n += 1;
    if (counts[key].rects.length < 5) counts[key].rects.push(rect(el));
  }
  return {
    dialog: { cls: dialog.className, rect: rect(dialog), background: cs.backgroundColor, radius: cs.borderRadius, padding: cs.padding },
    repeated: Object.entries(counts)
      .filter(([, v]) => v.n >= 2)
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 30)
      .map(([k, v]) => ({ sel: k, n: v.n, rects: v.rects })),
    text: dialog.innerText.split('\\n').filter(Boolean).slice(0, 40),
  };
}`;

(async () => {
  const browser = await connect();
  try {
    const pages = (await browser.pages()).filter((p) => /gemini\.google\.com\/notebook/.test(p.url()));
    if (!pages.length) throw new Error('no Gemini notebook tab');

    let page = null;
    for (const candidate of pages) {
      const open = await candidate.evaluate(() => !!document.querySelector('[role="dialog"]'));
      if (open) { page = candidate; console.log('a dialog is already open on this tab'); break; }
    }
    if (!page) {
      page = pages[0];
      const clicked = await page.evaluate(() => {
        const chip = document.querySelector('gem-source-list-chip');
        if (!chip) return false;
        chip.click();
        return true;
      });
      console.log(clicked ? 'clicked the chip' : 'no chip to click');
      await sleep(1400);
    }

    const shape = await page.evaluate(new Function('return ' + SHAPE)());
    save('src-chip/gemini-panel-shape.json', shape);
    console.log(JSON.stringify(shape, null, 2));

    if (!shape.error) {
      save('src-chip/gemini-panel-tree.json', await dumpTree(page, '[role="dialog"]', 16));
      const r = shape.dialog.rect;
      const buf = await page.screenshot({ clip: { x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 10), width: r.w + 20, height: r.h + 20 } });
      fs.writeFileSync(outPath('src-chip/gemini-panel.png'), buf);
      console.log('saved src-chip/gemini-panel.png + tree');
    }
  } finally {
    await browser.disconnect();
  }
})();
