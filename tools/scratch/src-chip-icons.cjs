/**
 * Compare the icon inside the "N Source(s)" chip (and the source rows) between the
 * Gemini notebook tab and the Willow notebook tab. Read-only.
 */
const { connect, save, outPath, sleep } = require('../ui-research/scrapers/notebooks/lib.cjs');
const fs = require('fs');

const PROBE = `(selectors) => {
  const describe = (el) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
    return {
      tag: el.tagName.toLowerCase(),
      cls: el.className && el.className.toString ? el.className.toString() : '',
      ownText: own,
      codepoints: Array.from(own.trim()).map((c) => 'U+' + c.codePointAt(0).toString(16)),
      fontFamily: cs.fontFamily,
      fontVariationSettings: cs.fontVariationSettings,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      fontFeatureSettings: cs.fontFeatureSettings,
      color: cs.color,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width * 10) / 10, h: Math.round(rect.height * 10) / 10 },
      html: el.outerHTML.slice(0, 900),
    };
  };

  const out = { url: location.href, groups: {}, fonts: [] };
  for (const [label, sel] of Object.entries(selectors)) {
    const els = Array.from(document.querySelectorAll(sel));
    out.groups[label] = els.map((el) => {
      const node = describe(el);
      node.descendants = Array.from(el.querySelectorAll('*'))
        .filter((g) => {
          const cs = getComputedStyle(g);
          const cls = g.className && g.className.toString ? g.className.toString() : '';
          return g.tagName.toLowerCase() === 'svg' || g.tagName.toLowerCase() === 'img'
            || /symbol|icon|material|lm-/i.test(cls) || /Symbols|Material|Icons/i.test(cs.fontFamily);
        })
        .map(describe);
      return node;
    });
  }

  for (const f of document.fonts) {
    out.fonts.push(f.family + ' | ' + f.status + ' | ' + f.style + ' ' + f.weight);
  }
  out.fonts = out.fonts.filter((v, i, a) => a.indexOf(v) === i);
  return out;
}`;

const WILLOW_SELECTORS = {
  chip: '.nb-source-chip',
  dialogRows: '[class*="nb-src"], [class*="nb-source-row"], [class*="nb-list-row"]',
};
const GEMINI_SELECTORS = {
  chip: 'gem-source-list-chip',
  dialogRows: '[class*="source-row"], [class*="source-item"], [class*="source-list-item"]',
};

(async () => {
  const browser = await connect();
  try {
    const pages = await browser.pages();
    const seen = new Set();
    for (const page of pages) {
      const url = page.url();
      if (!/gemini\.google\.com\/notebook|localhost:3000\/notebook/.test(url)) continue;
      const isWillow = /localhost/.test(url);
      const tag = isWillow ? 'willow' : 'gemini';
      if (seen.has(tag)) continue;
      seen.add(tag);
      console.log('\n=== ' + tag + ' ' + url);
      const data = await page.evaluate(
        new Function('return ' + PROBE)(),
        isWillow ? WILLOW_SELECTORS : GEMINI_SELECTORS,
      );
      save(`src-chip/${tag}.json`, data);
      for (const [label, nodes] of Object.entries(data.groups)) {
        console.log(`  -- ${label}: ${nodes.length}`);
        for (const n of nodes.slice(0, 6)) {
          console.log(`     ${n.tag}.${n.cls} ${n.rect.w}x${n.rect.h} text=${JSON.stringify(n.ownText)}`);
          for (const d of n.descendants.slice(0, 6)) {
            console.log(`        > ${d.tag}.${d.cls} ${d.rect.w}x${d.rect.h} text=${JSON.stringify(d.ownText)} cp=${d.codepoints.join(',')}`);
            console.log(`          font=${d.fontFamily} size=${d.fontSize} wght=${d.fontWeight} var=${d.fontVariationSettings}`);
            console.log(`          html=${d.html.replace(/\\s+/g, ' ').slice(0, 260)}`);
          }
        }
      }

      const chip = data.groups.chip && data.groups.chip[0];
      if (chip && chip.rect.w > 0) {
        const pad = 8;
        const clip = { x: Math.max(0, chip.rect.x - pad), y: Math.max(0, chip.rect.y - pad), width: chip.rect.w + pad * 2, height: chip.rect.h + pad * 2 };
        try {
          const buf = await page.screenshot({ clip, captureBeyondViewport: false });
          const p = outPath(`src-chip/${tag}-chip.png`);
          fs.writeFileSync(p, buf);
          console.log(`  saved src-chip/${tag}-chip.png`);
        } catch (e) {
          console.log('  screenshot failed: ' + e.message);
        }
      }
    }
    await sleep(50);
  } finally {
    await browser.disconnect();
  }
})();
