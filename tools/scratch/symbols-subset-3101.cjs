/**
 * tools/ui-research/scrapers/flow/54-symbols-subset.cjs, measured on the :3101 test origin in a
 * throwaway browser context of the debug Chrome instead of the :3000 tab (which belongs to the
 * user and other agents, and which 54 brings to the front). Prints the new Google Symbols URL.
 *
 *   node tools/scratch/symbols-subset-3101.cjs --add=check_box_outline_blank
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const REPO = path.resolve(__dirname, '../..');
const ROOTS = ['apps', 'features', 'platform'];
const ADD = (process.argv.find((a) => a.startsWith('--add=')) || '').split('=')[1];
const AXES = 'FILL,ROND,wght@0..1,0..100,100..700';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const SHORT_NAMES = ['tv'];
const BASE = process.env.WILLOW_URL || 'http://localhost:3101';

function harvest() {
  const names = new Set();
  let files = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['node_modules', 'dist', '.git'].includes(e.name)) continue;
        walk(p);
      } else if (/\.(tsx?|css|html)$/.test(e.name)) {
        files += 1;
        const src = fs.readFileSync(p, 'utf8');
        const re = /['"`]([a-z][a-z0-9_]{2,30})['"`]/g;
        let m;
        while ((m = re.exec(src))) names.add(m[1]);
      }
    }
  };
  for (const r of ROOTS) walk(path.join(REPO, r));
  return { files, names: [...names].sort() };
}

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 120_000 });
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await new Promise((r) => setTimeout(r, 5000));
    const { files, names } = harvest();
    const widths = await page.evaluate(async (list) => {
      await document.fonts.ready;
      try { await document.fonts.load('400 20px "Google Symbols"', list.join(' ')); } catch { /* not loaded */ }
      const s = document.createElement('span');
      s.style.cssText = 'position:absolute;left:-9999px;font-size:20px;line-height:1;white-space:nowrap;font-feature-settings:"liga";visibility:hidden;font-family:"Google Symbols"';
      document.body.appendChild(s);
      const out = {};
      for (const n of list) { s.textContent = n; out[n] = s.getBoundingClientRect().width; }
      s.remove();
      return out;
    }, names);
    const present = names.filter((n) => widths[n] <= 26);
    console.log(`${files} files scanned, ${names.length} candidates, ${present.length} resolve in the loaded face`);
    const wanted = [...new Set([...present, ...SHORT_NAMES, ...(ADD ? ADD.split(',') : [])])].sort();
    const url = `https://fonts.googleapis.com/css2?family=Google+Symbols:${AXES}&icon_names=${wanted.join(',')}&display=block`;
    const css = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
    const src = css.match(/url\((https:\/\/[^)]+)\)/);
    if (!src) throw new Error(`endpoint refused the request:\n${css.slice(0, 500)}`);
    const bytes = (await (await fetch(src[1], { headers: { 'User-Agent': UA } })).arrayBuffer()).byteLength;
    console.log(`requested ${wanted.length} icons, face is ${(bytes / 1024).toFixed(0)}KB`);
    console.log(src[1]);
  } finally {
    await context.close();
    await browser.disconnect();
  }
})().catch((e) => { console.error('FAILED:', e.stack || e.message); process.exit(1); });
