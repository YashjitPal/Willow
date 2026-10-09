// Compares each icon kit in apps/studio/index.html with HEAD's, by the ligature names in the font files.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const fontkit = require(path.join(process.env.TEMP, 'wfont/node_modules/fontkit'));
const REPO = path.resolve(__dirname, '../..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const arr = (v) => (v && typeof v.toArray === 'function' ? v.toArray() : v || []);

function ligatureNames(font) {
  const rev = new Map();
  for (const cp of font.characterSet) {
    const ch = String.fromCodePoint(cp);
    const id = font.glyphForCodePoint(cp).id;
    if (!rev.has(id) || (/[a-z0-9_]/.test(ch) && !/[a-z0-9_]/.test(rev.get(id)))) rev.set(id, ch);
  }
  const names = new Set();
  for (const lookup of arr(font.GSUB.lookupList)) {
    for (let sub of arr(lookup.subTables)) {
      let type = lookup.lookupType;
      if (type === 7) { type = sub.lookupType; sub = sub.extension; }
      if (type !== 4) continue;
      const cov = sub.coverage.glyphs ? arr(sub.coverage.glyphs) : (() => { const o = []; for (const r of arr(sub.coverage.rangeRecords)) for (let g = r.start; g <= r.end; g += 1) o[r.startCoverageIndex + g - r.start] = g; return o; })();
      arr(sub.ligatureSets).forEach((set, i) => {
        for (const lig of arr(set)) {
          const rest = arr(lig.components).map((id) => rev.get(id));
          if (rev.get(cov[i]) && rest.every(Boolean)) names.add(rev.get(cov[i]) + rest.join(''));
        }
      });
    }
  }
  return names;
}
const urlOf = (html, family) => html.match(new RegExp(`font-family:\\s*"${family}";[\\s\\S]{0,1200}?src:\\s*url\\("([^"]+)"\\)`))[1];
const namesAt = async (url) => ligatureNames(fontkit.create(Buffer.from(await (await fetch(url, { headers: { 'User-Agent': UA } })).arrayBuffer())));

(async () => {
  const head = execSync('git show HEAD:apps/studio/index.html', { cwd: REPO, encoding: 'utf8', maxBuffer: 32 << 20 });
  const now = fs.readFileSync(path.join(REPO, 'apps/studio/index.html'), 'utf8');
  for (const family of ['Luminous Symbols', 'Google Symbols']) {
    const [a, b] = await Promise.all([namesAt(urlOf(head, family)), namesAt(urlOf(now, family))]);
    const lost = [...a].filter((n) => !b.has(n));
    const gained = [...b].filter((n) => !a.has(n));
    console.log(`${family}: HEAD ${a.size}, now ${b.size}; missing vs HEAD: ${lost.join(', ') || 'none'}; added: ${gained.length}`);
  }
})().catch((e) => { console.error('FAILED:', e.stack || e.message); process.exit(1); });
