/**
 * Find the diameter Gemini gives the source tile's loading spinner.
 *
 * The class name `gem-attachment-loading-spinner` is a literal in the compiled Angular
 * template, so the surrounding bytes carry the element's property bindings — `diameter`
 * and `strokeWidth` among them. Read-only: fetches the page's own scripts in its own
 * context and searches them.
 */
const { connect, save } = require('../ui-research/scrapers/notebooks/lib.cjs');

const PROBE = `async (marker) => {
  const urls = Array.from(new Set([
    ...Array.from(document.querySelectorAll('script[src]')).map((s) => s.src),
    ...performance.getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => /\\.js(\\?|$)/.test(n) || /\\/_\\//.test(n)),
  ]));
  const hits = [];
  for (const url of urls) {
    let text;
    try {
      const res = await fetch(url);
      text = await res.text();
    } catch { continue; }
    let i = text.indexOf(marker);
    while (i !== -1 && hits.length < 12) {
      hits.push({ url, at: i, window: text.slice(Math.max(0, i - 700), i + 700) });
      i = text.indexOf(marker, i + 1);
    }
  }
  return { scripts: urls.length, hits };
}`;

(async () => {
  const browser = await connect();
  try {
    const page = (await browser.pages()).find((p) => /gemini\.google\.com\/notebook/.test(p.url()));
    if (!page) throw new Error('no Gemini notebook tab');

    for (const marker of ['gem-attachment-loading-spinner', 'gem-attachment-notebook']) {
      const res = await page.evaluate(new Function('return ' + PROBE)(), marker);
      console.log(`\n=== "${marker}" — ${res.hits.length} hit(s) across ${res.scripts} scripts`);
      res.hits.forEach((h, n) => {
        console.log(`\n--- hit ${n + 1} in ${h.url.split('/').pop()} @${h.at}`);
        console.log(h.window.replace(/\s+/g, ' '));
      });
      if (res.hits.length) save(`src-chip/bundle-${marker}.txt`, res.hits.map((h) => h.url + '\n' + h.window).join('\n\n====\n\n'));
    }
  } finally {
    await browser.disconnect();
  }
})();
