/** Gemini's `gem-source-list` / chip CSS, verbatim. Read-only. */
const { connect, save, dumpCssRules } = require('../ui-research/scrapers/notebooks/lib.cjs');

(async () => {
  const browser = await connect();
  try {
    const page = (await browser.pages()).find((p) => /gemini\.google\.com\/notebook/.test(p.url()));
    if (!page) throw new Error('no Gemini notebook tab');
    const rules = await dumpCssRules(page, /source-list|icon-container|lm-icon-s|source-chip/);
    save('src-chip/gemini-css.json', rules);
    for (const r of rules) {
      console.log((r.media ? `@media ${r.media} ` : '') + r.css.replace(/\s+/g, ' '));
      console.log('');
    }
  } finally {
    await browser.disconnect();
  }
})();
