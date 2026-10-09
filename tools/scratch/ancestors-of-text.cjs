/**
 * Finds the deepest element whose trimmed text equals (or, with --contains, includes) a
 * string, and prints it and its ancestors with boxes. Read-only.
 *
 *   node tools/scratch/ancestors-of-text.cjs gemini|willow "<text>" [depth=10] [--contains]
 */
const puppeteer = require('puppeteer-core');

const ORIGINS = { gemini: 'https://gemini.google.com', willow: 'http://localhost:3000' };

(async () => {
  const args = process.argv.slice(2);
  const contains = args.includes('--contains');
  const [which = 'gemini', text = '', depthArg = '10'] = args.filter((a) => !a.startsWith('--'));
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith(ORIGINS[which]));
  if (!page) throw new Error(`no ${which} tab`);
  const out = await page.evaluate((needle, max, loose) => {
    const matches = [...document.querySelectorAll('body *')].filter((el) => {
      const t = (el.textContent || '').trim();
      const r = el.getBoundingClientRect();
      return r.width > 0 && (loose ? t.includes(needle) : t === needle);
    });
    // Deepest: no other match inside it.
    const deepest = matches.filter((el) => !matches.some((other) => other !== el && el.contains(other)));
    if (!deepest.length) return ['no match'];
    const lines = [];
    for (const start of deepest.slice(0, 3)) {
      let el = start;
      for (let i = 0; i < max && el && el !== document.body; i += 1) {
        const r = el.getBoundingClientRect();
        lines.push(`${'  '.repeat(i)}${el.tagName.toLowerCase()}.${String(el.className).split(' ').filter((x) => x && !x.startsWith('ng-')).slice(0, 3).join('.')} [${[r.x, r.y, r.width, r.height].map((n) => Math.round(n))}]`);
        el = el.parentElement;
      }
      lines.push('---');
    }
    return lines;
  }, text, Number(depthArg), contains);
  console.log(out.join('\n'));
  browser.disconnect();
})();
