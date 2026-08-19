/** Reload Willow so it picks up index.html, then re-measure the three ligatures. */
const { connect, sleep } = require('../ui-research/scrapers/notebooks/lib.cjs');

const PROBE = `async () => {
  await document.fonts.ready;
  const ctx = document.createElement('canvas').getContext('2d');
  const m = (family, text) => { ctx.font = '100px "' + family + '"'; return Math.round(ctx.measureText(text).width); };
  const out = {};
  for (const family of ['Google Symbols', 'Luminous Symbols']) {
    for (const name of ['draft', 'description', 'picture_as_pdf', 'close']) {
      const w = m(family, name);
      const letters = Array.from(name).reduce((s, c) => s + m(family, c), 0);
      out[family + ' / ' + name] = (w < letters * 0.6 ? 'PRESENT' : 'MISSING') + '  w=' + w + ' letters=' + letters;
    }
  }
  return out;
}`;

(async () => {
  const browser = await connect();
  try {
    const page = (await browser.pages()).find((p) => /localhost:3000/.test(p.url()));
    if (!page) throw new Error('no Willow tab');
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(2500);
    const res = await page.evaluate(new Function('return ' + PROBE)());
    for (const [k, v] of Object.entries(res)) console.log(`  ${k.padEnd(38)} ${v}`);
  } finally {
    await browser.disconnect();
  }
})();
