// tools/ui-research/scrapers/flow/media/symbols-subset-3101.cjs in its own headless Chrome instead of
// the debug one: harvest names from the source, keep the ones the face served by :3101 resolves,
// add --add names, ask the css2 endpoint for that set, print the new face URL.
//   node tools/scratch/symbols-subset-headless.cjs --add=create_new_folder
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const REPO = path.resolve(__dirname, '../..');
const ROOTS = ['apps', 'features', 'platform'];
const ADD = (process.argv.find((a) => a.startsWith('--add=')) || '').split('=')[1];
// --check=a,b,c only reports which of these the current face resolves.
const CHECK = (process.argv.find((a) => a.startsWith('--check=')) || '').split('=')[1];
const AXES = 'FILL,ROND,wght@0..1,0..100,100..700';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
// Glyph names under three letters, which the harvest skips; see 54-symbols-subset.cjs.
const SHORT_NAMES = ['tv'];

function harvest() {
  const names = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['node_modules', 'dist', '.git'].includes(e.name)) walk(p); }
      else if (/\.(tsx?|css|html)$/.test(e.name)) {
        const src = fs.readFileSync(p, 'utf8');
        const re = /['"`]([a-z][a-z0-9_]{2,30})['"`]/g;
        let m;
        while ((m = re.exec(src))) names.add(m[1]);
      }
    }
  };
  for (const r of ROOTS) walk(path.join(REPO, r));
  return [...names].sort();
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-symbols-'));
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir,
  });
  try {
    const page = (await browser.pages())[0];
    await page.goto('http://localhost:3101/media', { waitUntil: 'networkidle2', timeout: 180000 }).catch(() => {});
    const names = CHECK ? CHECK.split(',') : harvest();
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
    if (CHECK) {
      for (const n of names) console.log(`${widths[n] <= 26 ? 'ok     ' : 'MISSING'} ${n} (${Math.round(widths[n])}px)`);
      return;
    }
    const added = ADD ? ADD.split(',') : [];
    console.log(`asked to add: ${added.map((n) => `${n} (${widths[n] <= 26 ? 'already resolves' : 'missing'})`).join(', ') || 'none'}`);
    const wanted = [...new Set([...present, ...SHORT_NAMES, ...added])].sort();
    const url = `https://fonts.googleapis.com/css2?family=Google+Symbols:${AXES}&icon_names=${wanted.join(',')}&display=block`;
    const css = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
    const src = css.match(/url\((https:\/\/[^)]+)\)/);
    if (!src) throw new Error(`endpoint refused the request:\n${css.slice(0, 500)}`);
    console.log(`${names.length} candidates, ${present.length} resolve now, requesting ${wanted.length}`);
    console.log(src[1]);
  } finally {
    await browser.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch((e) => { console.error('FAILED:', e.stack || e.message); process.exit(1); });
