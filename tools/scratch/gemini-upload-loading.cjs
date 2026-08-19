/**
 * Hunt for Gemini's "still extracting" state on a source tile.
 *
 * The tile's own component stylesheet carries the rules whether or not anything is
 * uploading, and it is a constructed sheet, so this goes through the CDP CSS domain.
 */
const { connect, save, sleep } = require('../ui-research/scrapers/notebooks/lib.cjs');

const INTERESTING = /progress|loading|spinner|indeterminate|skeleton|shimmer|pending|uploading|busy|dots|placeholder/i;

(async () => {
  const browser = await connect();
  try {
    const page = (await browser.pages()).find((p) => /gemini\.google\.com\/notebook/.test(p.url()));
    if (!page) throw new Error('no Gemini notebook tab');

    const open = await page.evaluate(() => !!document.querySelector('project-file-upload-item'));
    if (!open) {
      await page.evaluate(() => document.querySelector('gem-source-list-chip').click());
      await sleep(1600);
    }

    const client = await page.createCDPSession();
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    const { root } = await client.send('DOM.getDocument', { depth: -1, pierce: true });

    const sheetIds = new Set();
    for (const selector of [
      'project-file-upload-item',
      'project-file-upload-item .gem-attachment',
      'project-file-upload-item .gem-attachment-icon',
      'project-uploader-preview-container',
      'gem-source-list .icon-container',
    ]) {
      const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      if (!nodeId) { console.log(`  (no match: ${selector})`); continue; }
      const matched = await client.send('CSS.getMatchedStylesForNode', { nodeId });
      for (const entry of matched.matchedCSSRules || []) {
        if (entry.rule.styleSheetId) sheetIds.add(entry.rule.styleSheetId);
      }
    }
    console.log(`${sheetIds.size} stylesheet(s) behind the tile`);

    const texts = [];
    for (const id of sheetIds) {
      const { text } = await client.send('CSS.getStyleSheetText', { styleSheetId: id });
      texts.push(text);
    }
    const joined = texts.join('\n\n');
    save('src-chip/gemini-upload-item.css', joined);

    console.log('\n=== rules mentioning a loading state');
    const seen = new Set();
    for (const block of joined.split('}')) {
      if (!INTERESTING.test(block)) continue;
      const line = block.trim().replace(/\s+/g, ' ') + ' }';
      if (seen.has(line)) continue;
      seen.add(line);
      console.log('  ' + line.slice(0, 400));
    }
    await client.detach();
  } finally {
    await browser.disconnect();
  }
})();
