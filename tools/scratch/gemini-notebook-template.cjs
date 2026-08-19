/**
 * The notebook tile's compiled template, so the loading branch can be read structurally
 * rather than inferred from CSS alone.
 *
 * Two things worth settling. The COMPOSER variant has
 * `.gem-attachment-content.loading { align-items: center; justify-content: center }` — its
 * spinner is centred and the name is dropped. The NOTEBOOK variant has no such rule; it has
 * `.gem-attachment-loading-spinner { position: absolute; top: 0; inset-inline-start: 0 }`
 * instead, i.e. the spinner stands in the icon's corner and the name stays put. That is the
 * difference the tile in Willow has to reproduce, and it is the opposite of what reusing the
 * composer's loading state would have given.
 *
 * The other is `gem-attachment-processing-info`, a text line the notebook variant declares
 * and the composer does not. This reads the template to see what it is next to.
 */
const { connect, save } = require('../ui-research/scrapers/notebooks/lib.cjs');

const PROBE = `async () => {
  const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /N9BqIf/.test(n));
  const out = { urls: urls.length, found: [] };
  for (const url of urls) {
    let text;
    try { text = await (await fetch(url)).text(); } catch { continue; }
    // The notebook branch's consts sit right before its template function.
    const anchor = text.indexOf('gem-attachment-loading-spinner');
    if (anchor < 0) continue;
    // Every template function in the component, with its node/binding counts.
    const tmplRe = /_\\.(?:Wz|Yx|C)\\(\\d+,\\s*([A-Za-z0-9_$]+),\\s*(\\d+),\\s*(\\d+)/g;
    const region = text.slice(Math.max(0, anchor - 4000), anchor + 12000);
    const templates = [];
    let m;
    while ((m = tmplRe.exec(region))) templates.push({ fn: m[1], nodes: +m[2], bindings: +m[3] });
    // And the named template bodies, which is where the element order lives.
    const bodies = {};
    for (const name of new Set(templates.map((t) => t.fn))) {
      const at = text.indexOf('function ' + name);
      if (at >= 0) bodies[name] = text.slice(at, at + 1400);
    }
    out.found.push({ url: url.slice(0, 90), templates, bodies });
  }
  return out;
}`;

(async () => {
  const browser = await connect();
  try {
    const page = (await browser.pages()).find((p) => /gemini\.google\.com\/notebook/.test(p.url()));
    if (!page) throw new Error('no Gemini notebook tab open');
    const res = await page.evaluate(new Function('return ' + PROBE)());
    save('src-chip/gemini-notebook-template.json', res);
    for (const hit of res.found) {
      console.log('=== ' + hit.url);
      console.log('templates:', JSON.stringify(hit.templates));
      for (const [name, body] of Object.entries(hit.bodies)) {
        // Only the class names and element tags matter here.
        const marks = body.match(/"[a-z-]+"|gem-attachment-[a-z-]+|mat-[a-z-]+/g) || [];
        console.log('  ' + name + ': ' + [...new Set(marks)].join(' '));
      }
    }
  } finally {
    await browser.disconnect();
  }
})();
