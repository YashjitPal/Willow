// Which glyphs the served Google Symbols face resolves that today's source no longer names: the
// names a regenerated subset (symbols-subset-headless.cjs) would drop. Candidates are the string
// literals of apps/, features/ and platform/ at HEAD and in the working tree.
//   node tools/scratch/symbols-dropped.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const REPO = path.resolve(__dirname, '../..');
const ROOTS = ['apps', 'features', 'platform'];
const literals = (src, into) => {
  const re = /['"`]([a-z][a-z0-9_]{2,30})['"`]/g;
  let m;
  while ((m = re.exec(src))) into.add(m[1]);
};
const now = new Set();
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'dist', '.git'].includes(e.name)) walk(p); } else if (/\.(tsx?|css|html)$/.test(e.name)) literals(fs.readFileSync(p, 'utf8'), now);
  }
};
for (const r of ROOTS) walk(path.join(REPO, r));
const before = new Set();
const files = execSync(`git ls-files ${ROOTS.join(' ')}`, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter((f) => /\.(tsx?|css|html)$/.test(f));
for (const f of files) {
  try { literals(execSync(`git show HEAD:"${f}"`, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }), before); } catch { /* new file */ }
}
const gone = [...before].filter((n) => !now.has(n));

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-symbols-'));
  const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, userDataDir });
  try {
    const page = (await browser.pages())[0];
    await page.goto('http://localhost:3101/media', { waitUntil: 'networkidle2', timeout: 180000 }).catch(() => {});
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
    }, gone);
    console.log(`${gone.length} names gone from the source since HEAD; the served face resolves:`);
    console.log(gone.filter((n) => widths[n] <= 26).join(', ') || '(none)');
  } finally {
    await browser.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
