/**
 * Gemini's `gem-source-list` rules, including the stacked-variant ones that only apply
 * with 2+ sources.
 *
 * `document.styleSheets` cannot see these — Angular installs them as constructed
 * stylesheets — so this goes through the CDP CSS domain instead, which reports the
 * stylesheet a matched rule came from. Read-only, and it needs no second source in the
 * notebook: the rules are there whether or not anything matches them.
 */
const { connect, save } = require('../ui-research/scrapers/notebooks/lib.cjs');

(async () => {
  const browser = await connect();
  try {
    const page = (await browser.pages()).find((p) => /gemini\.google\.com\/notebook/.test(p.url()));
    if (!page) throw new Error('no Gemini notebook tab');

    const client = await page.createCDPSession();
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    const { root } = await client.send('DOM.getDocument', { depth: -1, pierce: true });

    const { nodeId } = await client.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: 'gem-source-list .icon-container',
    });
    if (!nodeId) throw new Error('no .icon-container found');

    const matched = await client.send('CSS.getMatchedStylesForNode', { nodeId });
    const sheetIds = new Set();
    const rules = [];
    for (const entry of matched.matchedCSSRules || []) {
      const r = entry.rule;
      if (r.styleSheetId) sheetIds.add(r.styleSheetId);
      rules.push({
        selector: r.selectorList.text,
        origin: r.origin,
        css: (r.style.cssProperties || []).map((p) => `${p.name}: ${p.value}`).join('; '),
      });
    }
    console.log('=== rules matching the icon disc');
    for (const r of rules) console.log(`  ${r.selector}\n     { ${r.css} }`);

    // The whole sheet, so the stacked/overlap rules that match nothing right now show up.
    const texts = [];
    for (const id of sheetIds) {
      const { text } = await client.send('CSS.getStyleSheetText', { styleSheetId: id });
      texts.push(text);
    }
    const joined = texts.join('\n\n');
    save('src-chip/gemini-source-list.css', joined);

    console.log('\n=== every rule mentioning icon-container / source-list / stacked');
    for (const block of joined.split('}')) {
      if (/icon-container|source-list|stacked|overlap|:not\(:first-child\)|nth-child/i.test(block)) {
        console.log('  ' + block.trim().replace(/\s+/g, ' ') + ' }');
      }
    }
    await client.detach();
  } finally {
    await browser.disconnect();
  }
})();
