/** Why is Willow's "1 Source" label 2.5px wider than Gemini's? Compare text metrics. */
const { connect } = require('../ui-research/scrapers/notebooks/lib.cjs');

const PROBE = `(sel) => {
  const el = document.querySelector(sel);
  if (!el) return { error: 'not found: ' + sel };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const range = document.createRange();
  const textNode = Array.from(el.childNodes).find((n) => n.nodeType === 3 && n.textContent.trim());
  let textWidth = null;
  if (textNode) { range.selectNodeContents(textNode); textWidth = Math.round(range.getBoundingClientRect().width * 100) / 100; }
  return {
    text: el.textContent.trim(),
    rect: { w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 },
    textWidth,
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    fontStretch: cs.fontStretch,
    letterSpacing: cs.letterSpacing,
    fontVariationSettings: cs.fontVariationSettings,
    fontFeatureSettings: cs.fontFeatureSettings,
    fontKerning: cs.fontKerning,
  };
}`;

(async () => {
  const browser = await connect();
  try {
    const pages = await browser.pages();
    for (const [tag, match, sel] of [
      ['gemini', /gemini\.google\.com\/notebook/, '.gem-source-list-chip-text'],
      ['willow', /localhost:3000\/notebook/, '.nb-source-chip'],
    ]) {
      const page = pages.find((p) => match.test(p.url()));
      if (!page) { console.log(`no ${tag} tab`); continue; }
      const res = await page.evaluate(new Function('return ' + PROBE)(), sel);
      console.log(`\n=== ${tag}`);
      for (const [k, v] of Object.entries(res)) console.log(`  ${k}: ${JSON.stringify(v)}`);
    }
  } finally {
    await browser.disconnect();
  }
})();
