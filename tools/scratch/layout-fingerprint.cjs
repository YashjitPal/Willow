/**
 * Willow (never the media tab): records a layout fingerprint of what is on screen — every
 * visible element's tag, classes, box and a few computed styles, in DOM order — or
 * compares the screen against one recorded earlier. Used to prove a change left the
 * desktop layout exactly as it was. No text is recorded.
 *
 *   node tools/scratch/layout-fingerprint.cjs save <name>
 *   node tools/scratch/layout-fingerprint.cjs compare <name>
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const [mode = 'save', name = 'default'] = process.argv.slice(2);
const file = path.join(process.env.TEMP, `layout-fp-${name}.json`);

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  await page.bringToFront();
  await new Promise((r) => setTimeout(r, 800));
  const snap = await page.evaluate(() => {
    const r = (n) => Math.round(n);
    const out = [];
    for (const el of document.querySelectorAll('#root *, body > div:not(#root) *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const b = el.getBoundingClientRect();
      if (!b.width && !b.height) continue;
      if (b.bottom < 0 || b.top > innerHeight || b.right < 0 || b.left > innerWidth) continue;
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 6).join('.') : '';
      out.push(`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} [${r(b.x)},${r(b.y)},${r(b.width)},${r(b.height)}] ${cs.fontSize} ${cs.padding} ${cs.opacity}`);
    }
    return { viewport: `${innerWidth}x${innerHeight}`, path: location.pathname + location.search, items: out };
  });
  if (mode === 'save') {
    fs.writeFileSync(file, JSON.stringify(snap));
    console.log(`saved ${snap.items.length} elements at ${snap.viewport} (${snap.path}) -> ${path.basename(file)}`);
  } else {
    const before = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Geometry and styles only: a class added as a hook for narrow-screen rules is not a layout change.
    const strip = (s) => s.replace(/^(\w+)(\.[^ ]+)? /, '$1 ');
    const a = before.items.map(strip);
    const b = snap.items.map(strip);
    // Aligned by longest common subsequence, so a wrapper added with no geometry of its own
    // shows as one added element instead of shifting every element after it.
    const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    const removed = [];
    const added = [];
    for (let i = 0, j = 0; i < a.length || j < b.length;) {
      if (i < a.length && j < b.length && a[i] === b[j]) { i += 1; j += 1; }
      else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) added.push(`+ #${j} ${b[j++]}`);
      else removed.push(`- #${i} ${a[i++]}`);
    }
    const verdict = removed.length || added.length ? `${removed.length} removed, ${added.length} added` : 'identical';
    console.log(`${name}: ${a.length} -> ${b.length} elements at ${before.viewport} -> ${snap.viewport}; ${verdict}`);
    for (const d of [...removed, ...added].slice(0, 15)) console.log(`   ${d}`);
  }
  browser.disconnect();
})();
