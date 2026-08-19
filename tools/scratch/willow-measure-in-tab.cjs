/**
 * Measure Willow's chip and sources panel in the user's own tab. Read-only apart from the
 * navigation and opening/closing the panel: the notebook already holds four sources, so
 * nothing is added or removed. Leaves the tab where it found it.
 */
const { connect, outPath, sleep } = require('../ui-research/scrapers/notebooks/lib.cjs');
const fs = require('fs');

const MEASURE = `() => {
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100, w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 }; };
  const short = (s) => (s || '').replace('https://www.google.com/s2/', 's2/').replace(/^.*file-type-icons\\//, 'file-type-icons/').slice(0, 96);
  const out = {};
  const chip = document.querySelector('.nb-source-chip');
  if (chip) {
    out.chip = {
      label: chip.textContent.trim(),
      rect: rect(chip),
      background: getComputedStyle(chip).backgroundColor,
      discs: Array.from(chip.querySelectorAll('.nb-source-chip-icon')).map((d) => {
        const img = d.querySelector('img');
        const cs = getComputedStyle(d);
        return { x: rect(d).x, w: rect(d).w, zIndex: cs.zIndex, margin: cs.marginInlineStart, icon: img ? short(img.getAttribute('src')) : d.textContent.trim() };
      }),
    };
  }
  const grid = document.querySelector('.nb-src-tiles');
  if (grid) {
    const cs = getComputedStyle(grid);
    out.grid = { rect: rect(grid), display: cs.display, columns: cs.gridTemplateColumns, gap: cs.gap, paddingBottom: cs.paddingBottom };
    out.tiles = Array.from(grid.querySelectorAll('.nb-src-tile')).map((t) => {
      const tcs = getComputedStyle(t);
      const icon = t.querySelector('.nb-src-tile-icon');
      const img = icon.querySelector('img');
      const name = t.querySelector('.nb-src-tile-name');
      const ncs = getComputedStyle(name);
      const close = t.querySelector('.nb-src-tile-remove');
      const ccs = getComputedStyle(close);
      return {
        rect: rect(t),
        background: tcs.backgroundColor,
        radius: tcs.borderRadius,
        title: t.getAttribute('title'),
        label: name.textContent,
        iconRect: rect(icon),
        iconSrc: img ? short(img.getAttribute('src')) : icon.textContent.trim(),
        iconLoaded: img ? (img.complete && img.naturalWidth > 0) : null,
        nameFont: ncs.fontSize + '/' + ncs.lineHeight + ' ' + ncs.fontVariationSettings,
        nameRect: rect(name),
        close: { rect: rect(close), visibility: ccs.visibility, background: ccs.backgroundColor },
      };
    });
  }
  const dialog = document.querySelector('.nb-src');
  if (dialog) out.dialog = { rect: rect(dialog), background: getComputedStyle(dialog).backgroundColor, radius: getComputedStyle(dialog).borderRadius };
  return out;
}`;

(async () => {
  const browser = await connect();
  try {
    const page = (await browser.pages()).find((p) => /localhost:3000\/notebook/.test(p.url()));
    if (!page) throw new Error('no Willow notebooks tab');
    const startedAt = page.url();

    if (!/\/notebook\//.test(startedAt)) {
      await page.waitForSelector('.nb-card', { timeout: 20000 });
      await page.evaluate(() => document.querySelector('.nb-card').click());
      await sleep(2000);
    }
    console.log('at', page.url());

    let res = await page.evaluate(new Function('return ' + MEASURE)());
    console.log('\n=== chip');
    console.log(JSON.stringify(res.chip, null, 2));
    if (res.chip) {
      const r = res.chip.rect;
      fs.writeFileSync(outPath('src-chip/willow-chip-4.png'),
        await page.screenshot({ clip: { x: r.x - 8, y: r.y - 8, width: r.w + 16, height: r.h + 16 } }));
      console.log('saved src-chip/willow-chip-4.png');
    }

    await page.evaluate(() => document.querySelector('.nb-source-chip').click());
    await sleep(1200);
    res = await page.evaluate(new Function('return ' + MEASURE)());
    console.log('\n=== panel');
    console.log(JSON.stringify({ dialog: res.dialog, grid: res.grid, tiles: res.tiles }, null, 2));
    if (res.dialog) {
      const r = res.dialog.rect;
      fs.writeFileSync(outPath('src-chip/willow-panel.png'),
        await page.screenshot({ clip: { x: r.x - 10, y: r.y - 10, width: r.w + 20, height: r.h + 20 } }));
      console.log('saved src-chip/willow-panel.png');
    }

    // Hover one tile so the close button can be seen in place.
    const hovered = await page.evaluate(() => {
      const tile = document.querySelector('.nb-src-tile');
      if (!tile) return null;
      const r = tile.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
    });
    if (hovered) {
      await page.mouse.move(hovered.x, hovered.y);
      await sleep(400);
      fs.writeFileSync(outPath('src-chip/willow-tile-hover.png'),
        await page.screenshot({ clip: { x: hovered.rect.x - 6, y: hovered.rect.y - 6, width: hovered.rect.w + 12, height: hovered.rect.h + 12 } }));
      console.log('saved src-chip/willow-tile-hover.png');
      await page.mouse.move(10, 10);
    }

    await page.evaluate(() => {
      const scrim = document.querySelector('.nb-sheet-scrim');
      if (scrim) scrim.click();
    });
    await sleep(500);
    console.log('\npanel closed; sources untouched:', JSON.stringify(await page.evaluate(() =>
      Array.from(document.querySelectorAll('.nb-src-tile')).length)));
  } finally {
    await browser.disconnect();
  }
})();
