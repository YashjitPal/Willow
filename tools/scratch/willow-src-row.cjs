/** Open Willow's sources dialog, capture the source row, close it again. */
const { connect, outPath, sleep } = require('../ui-research/scrapers/notebooks/lib.cjs');
const fs = require('fs');

(async () => {
  const browser = await connect();
  try {
    const page = (await browser.pages()).find((p) => /localhost:3000\/notebook/.test(p.url()));
    if (!page) throw new Error('no Willow notebook tab');

    await page.evaluate(() => document.querySelector('.nb-source-chip').click());
    await sleep(600);

    const info = await page.evaluate(() => {
      const row = document.querySelector('.nb-src-row');
      if (!row) return { error: 'no row' };
      const r = row.getBoundingClientRect();
      const img = row.querySelector('img');
      const glyph = row.querySelector('.google-symbols, .luminous-symbols');
      return {
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        img: img ? { src: img.getAttribute('src'), w: img.getBoundingClientRect().width } : null,
        glyphText: glyph ? glyph.textContent : null,
        html: row.outerHTML.slice(0, 600),
      };
    });
    console.log(JSON.stringify(info, null, 2));

    if (!info.error) {
      const clip = { x: info.rect.x - 4, y: info.rect.y - 4, width: info.rect.w + 8, height: info.rect.h + 8 };
      const buf = await page.screenshot({ clip });
      const p = outPath('src-chip/willow-row.png');
      fs.writeFileSync(p, buf);
      console.log('saved src-chip/willow-row.png');
    }

    await page.keyboard.press('Escape');
    await sleep(300);
  } finally {
    await browser.disconnect();
  }
})();
