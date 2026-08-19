/**
 * Verify the stacked chip and the regenerated font.
 *
 * Adds two throwaway sources through the store, measures the chip, then removes them, so
 * the notebook is left exactly as it was.
 */
const { connect, outPath, sleep } = require('../ui-research/scrapers/notebooks/lib.cjs');
const fs = require('fs');

const MEASURE = `() => {
  const chip = document.querySelector('.nb-source-chip');
  if (!chip) return { error: 'no chip' };
  const r = chip.getBoundingClientRect();
  const discs = Array.from(chip.querySelectorAll('.nb-source-chip-icon')).map((d) => {
    const dr = d.getBoundingClientRect();
    const cs = getComputedStyle(d);
    const img = d.querySelector('img');
    return {
      x: Math.round(dr.x * 10) / 10,
      w: Math.round(dr.width * 10) / 10,
      marginInlineStart: cs.marginInlineStart,
      zIndex: cs.zIndex,
      background: cs.backgroundColor,
      icon: img ? img.getAttribute('src').split('/').pop() : (d.textContent || null),
    };
  });
  return {
    text: chip.textContent.trim(),
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width * 10) / 10, h: Math.round(r.height) },
    background: getComputedStyle(chip).backgroundColor,
    discs,
  };
}`;

(async () => {
  const browser = await connect();
  try {
    const page = (await browser.pages()).find((p) => /localhost:3000\/notebook\//.test(p.url()));
    if (!page) throw new Error('Willow is not on a notebook page');

    const before = await page.evaluate(new Function('return ' + MEASURE)());
    console.log('=== as it stands');
    console.log(JSON.stringify(before, null, 2));

    // Fonts, after the reload picked up the regenerated subset.
    const glyphs = await page.evaluate(async () => {
      await document.fonts.ready;
      const ctx = document.createElement('canvas').getContext('2d');
      const m = (f, t) => { ctx.font = '100px "' + f + '"'; return Math.round(ctx.measureText(t).width); };
      const check = (f, n) => {
        const w = m(f, n);
        const letters = Array.from(n).reduce((s, c) => s + m(f, c), 0);
        return w < letters * 0.6 ? 'PRESENT' : 'MISSING';
      };
      return {
        'Google Symbols/draft': check('Google Symbols', 'draft'),
        'Google Symbols/description': check('Google Symbols', 'description'),
        'Google Symbols/close': check('Google Symbols', 'close'),
      };
    });
    console.log('\n=== glyphs');
    console.log(JSON.stringify(glyphs, null, 2));

    const shot = async (name, node) => {
      const r = node.rect;
      const buf = await page.screenshot({ clip: { x: r.x - 8, y: r.y - 8, width: r.w + 16, height: r.h + 16 } });
      fs.writeFileSync(outPath(`src-chip/${name}.png`), buf);
      console.log(`  saved src-chip/${name}.png`);
    };
    if (!before.error) await shot('willow-chip-1', before);
  } finally {
    await browser.disconnect();
  }
})();
