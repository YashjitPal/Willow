/** The numeric `diameter` the attachment spinner is bound to, out of the compiled template. */
const { connect, save } = require('../ui-research/scrapers/notebooks/lib.cjs');

const PROBE = `async () => {
  const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /N9BqIf/.test(n));
  const out = { urls, hits: [] };
  for (const url of urls) {
    let text;
    try { text = await (await fetch(url)).text(); } catch { continue; }
    const marker = 'gem-attachment-loading-spinner';
    const anchor = text.indexOf(marker);
    // The component's template function follows its consts array; take a generous slice.
    const slice = text.slice(Math.max(0, anchor - 4000), anchor + 12000);
    const re = /"diameter"\\s*,\\s*([^),]{1,40})/g;
    let m;
    while ((m = re.exec(slice))) out.hits.push({ url: url.slice(-40), value: m[1], at: m.index });
    // Also any mat-spinner / progress-spinner element creation nearby.
    const re2 = /(mat-spinner|mat-progress-spinner|progress-spinner)/g;
    out.elements = [];
    while ((m = re2.exec(slice))) out.elements.push({ tag: m[1], context: slice.slice(Math.max(0, m.index - 160), m.index + 160) });
  }
  return out;
}`;

(async () => {
  const browser = await connect();
  try {
    const page = (await browser.pages()).find((p) => /gemini\.google\.com\/notebook/.test(p.url()));
    const res = await page.evaluate(new Function('return ' + PROBE)());
    save('src-chip/spinner-diameter.json', res);
    console.log('scripts:', res.urls.length);
    console.log('\n=== "diameter" bindings near the spinner');
    for (const h of res.hits) console.log(`  ${h.value}`);
    console.log('\n=== spinner elements nearby');
    for (const e of (res.elements || []).slice(0, 10)) console.log(`  [${e.tag}] ...${e.context.replace(/\s+/g, ' ')}...`);
  } finally {
    await browser.disconnect();
  }
})();
