/**
 * `tools/ui-research/scrapers/flow/54-symbols-subset.cjs`, connecting to the debug Chrome on
 * [::1]:9222 instead of the default profile's port. Harvests ligature-looking names from the
 * source, measures which resolve in the Google Symbols face the running Willow tab loaded,
 * adds `--add` names, and prints the css2 subset URL for `apps/studio/index.html`.
 *
 *   node tools/scratch/symbols-subset.cjs --add=name_one,name_two
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const REPO = path.resolve(__dirname, '../..');
const ROOTS = ['apps', 'features', 'platform'];
const ADD = (process.argv.find((a) => a.startsWith('--add=')) || '').split('=')[1];
const AXES = 'FILL,ROND,wght@0..1,0..100,100..700';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

function harvest() {
  const names = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['node_modules', 'dist', '.git'].includes(e.name)) continue;
        walk(p);
      } else if (/\.(tsx?|css|html)$/.test(e.name)) {
        const re = /['"`]([a-z][a-z0-9_]{2,30})['"`]/g;
        const src = fs.readFileSync(p, 'utf8');
        let m;
        while ((m = re.exec(src))) names.add(m[1]);
      }
    }
  };
  for (const r of ROOTS) walk(path.join(REPO, r));
  return [...names].sort();
}

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 0 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000'));
  if (!page) throw new Error('Willow is not open on :3000');
  const names = harvest();
  const widths = await page.evaluate(async (list) => {
    await document.fonts.ready;
    try { await document.fonts.load('400 20px "Google Symbols"', list.join(' ')); } catch { /* not loaded */ }
    const s = document.createElement('span');
    s.style.cssText = 'position:absolute;left:-9999px;font-size:20px;line-height:1;white-space:nowrap;'
      + 'font-feature-settings:"liga";visibility:hidden;font-family:"Google Symbols"';
    document.body.appendChild(s);
    const out = {};
    for (const n of list) { s.textContent = n; out[n] = s.getBoundingClientRect().width; }
    s.remove();
    return out;
  }, names);
  const present = names.filter((n) => widths[n] <= 26);
  const added = ADD ? ADD.split(',').filter(Boolean) : [];
  const missing = added.filter((n) => !present.includes(n));
  console.log(`${names.length} candidates, ${present.length} resolve now; adding ${missing.length}: ${missing.join(' ')}`);
  const wanted = [...new Set([...present, ...added])].sort();
  const url = `https://fonts.googleapis.com/css2?family=Google+Symbols:${AXES}&icon_names=${wanted.join(',')}&display=block`;
  const css = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
  const src = css.match(/url\((https:\/\/[^)]+)\)/);
  if (!src) throw new Error(`endpoint refused the request:\n${css.slice(0, 500)}`);
  const bytes = (await (await fetch(src[1], { headers: { 'User-Agent': UA } })).arrayBuffer()).byteLength;
  console.log(`requested ${wanted.length} icons, face is ${(bytes / 1024).toFixed(0)}KB`);
  console.log(`URL ${src[1]}`);
  browser.disconnect();
})().catch((e) => { console.error('FAILED:', e.stack || e.message); process.exit(1); });
