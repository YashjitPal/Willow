/**
 * Checks whether icon ligatures exist in Willow's subset fonts: renders each name at 24px
 * and reports its width (a real ligature is one ~24px glyph; a missing one spells itself).
 *
 *   node tools/scratch/glyph-present.cjs luminous:book_5 google:drive ...
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const specs = process.argv.slice(2).map((s) => { const [f, n] = s.split(':'); return { cls: f === 'google' ? 'google-symbols' : f === 'material' ? 'material-symbols-rounded' : 'luminous-symbols', name: n }; });
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const willow = (await browser.pages()).find((p) => (p.url().startsWith('http://localhost:3000') && !p.url().includes('/media')));
  const out = await willow.evaluate(async (list) => {
    await document.fonts.ready;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:24px;line-height:24px;white-space:nowrap';
    document.body.appendChild(host);
    const rows = [];
    for (const { cls, name } of list) {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = name;
      span.style.fontSize = '24px';
      host.appendChild(span);
      await document.fonts.load(`24px "${cls === 'google-symbols' ? 'Google Symbols' : cls === 'luminous-symbols' ? 'Luminous Symbols' : 'Material Symbols Rounded'}"`, name);
      rows.push(`${cls}:${name} width ${Math.round(span.getBoundingClientRect().width * 10) / 10}`);
    }
    host.remove();
    return rows.join('\n');
  }, specs);
  console.log(out);
  browser.disconnect();
})();
