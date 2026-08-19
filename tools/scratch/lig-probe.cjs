/**
 * Does a ligature exist in a subsetted icon face? Measure it.
 *
 * A present ligature collapses to one em-square advance; a missing one measures as
 * the sum of its letters, which is how a bad icon name renders as stray glyphs.
 */
const { connect } = require('../ui-research/scrapers/notebooks/lib.cjs');

const PROBE = `(spec) => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const measure = (family, text) => {
    ctx.font = '100px "' + family + '"';
    return Math.round(ctx.measureText(text).width * 10) / 10;
  };
  const out = {};
  for (const [family, names] of Object.entries(spec)) {
    const em = measure(family, '\\uE000');
    out[family] = names.map((n) => {
      const w = measure(family, n);
      const letters = Array.from(n).reduce((s, c) => s + measure(family, c), 0);
      return {
        name: n,
        width: w,
        lettersWidth: Math.round(letters * 10) / 10,
        present: w < letters * 0.6,
      };
    });
    out[family + '__emBox'] = em;
    out[family + '__loaded'] = document.fonts.check('100px "' + family + '"');
  }
  return out;
}`;

const NAMES = [
  'description', 'picture_as_pdf', 'draft', 'article', 'note_stack', 'docs',
  'chat_bubble', 'close', 'attach_file', 'image', 'movie', 'mic', 'web', 'content_paste',
];

(async () => {
  const browser = await connect();
  try {
    const page = (await browser.pages()).find((p) => /localhost:3000/.test(p.url()));
    if (!page) throw new Error('no Willow tab');
    console.log(page.url());
    const res = await page.evaluate(new Function('return ' + PROBE)(), {
      'Luminous Symbols': NAMES,
      'Google Symbols': NAMES,
    });
    for (const family of ['Luminous Symbols', 'Google Symbols']) {
      console.log(`\n${family}  loaded=${res[family + '__loaded']}`);
      for (const r of res[family]) {
        console.log(`  ${r.present ? 'OK     ' : 'MISSING'} ${r.name.padEnd(18)} w=${String(r.width).padEnd(8)} letters=${r.lettersWidth}`);
      }
    }
  } finally {
    await browser.disconnect();
  }
})();
