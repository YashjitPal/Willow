/**
 * Read-only: measure Willow's chip and sources panel in a window of our own, against the
 * notebook that already holds four sources. Writes nothing to the user's data and never
 * touches the tab they are using.
 */
const { connect, openOwnWindow, outPath, sleep } = require('../ui-research/scrapers/notebooks/lib.cjs');
const fs = require('fs');

const MEASURE = `() => {
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100, w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 }; };
  const short = (s) => (s || '').replace(/^https:\\/\\/www\\.google\\.com\\/s2\\//, 's2/').replace(/^.*file-type-icons\\//, 'file-type-icons/').slice(0, 96);
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
        nameFont: ncs.fontSize + '/' + ncs.lineHeight + ' ' + ncs.fontVariationSettings,
        nameRect: rect(name),
        close: { rect: rect(close), visibility: ccs.visibility, background: ccs.backgroundColor },
      };
    });
  }
  const dialog = document.querySelector('.nb-sheet');
  if (dialog) out.dialog = { rect: rect(dialog), background: getComputedStyle(dialog).backgroundColor, radius: getComputedStyle(dialog).borderRadius };
  return out;
}`;

(async () => {
  const browser = await connect();
  let page = null;
  try {
    page = await openOwnWindow(browser, 'http://localhost:3000/notebooks/view');
    await sleep(4500);
    try {
      await page.waitForSelector('.nb-card', { timeout: 20000 });
    } catch {
      console.log('no card. url:', page.url());
      console.log((await page.evaluate(() => document.body.innerText)).slice(0, 600));
      throw new Error('notebooks list did not render');
    }
    await page.evaluate(() => document.querySelector('.nb-card').click());
    await page.waitForSelector('.nb-source-chip', { timeout: 20000 });
    await sleep(1500);
    console.log('at', page.url());

    let res = await page.evaluate(new Function('return ' + MEASURE)());
    console.log('\n=== chip, 4 sources');
    console.log(JSON.stringify(res.chip, null, 2));
    if (res.chip) {
      const r = res.chip.rect;
      fs.writeFileSync(outPath('src-chip/willow-chip-4.png'),
        await page.screenshot({ clip: { x: r.x - 8, y: r.y - 8, width: r.w + 16, height: r.h + 16 } }));
      console.log('saved src-chip/willow-chip-4.png');
    }

    await page.evaluate(() => document.querySelector('.nb-source-chip').click());
    await sleep(1100);
    res = await page.evaluate(new Function('return ' + MEASURE)());
    console.log('\n=== panel');
    console.log(JSON.stringify({ dialog: res.dialog, grid: res.grid, tiles: res.tiles }, null, 2));
    if (res.dialog) {
      const r = res.dialog.rect;
      fs.writeFileSync(outPath('src-chip/willow-panel.png'),
        await page.screenshot({ clip: { x: r.x - 10, y: r.y - 10, width: r.w + 20, height: r.h + 20 } }));
      console.log('saved src-chip/willow-panel.png');
    }
  } finally {
    if (page) await page.close();
    await browser.disconnect();
  }
})();
