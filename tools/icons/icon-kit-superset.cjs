// Adds icons to an icon-font kit in apps/studio/index.html WITHOUT dropping any: the current kit's
// ligature names are read out of the font file itself (GSUB), not guessed from the source, and the
// rebuilt kit is parsed again and must contain every one of them before anything is written.
// Needs fontkit installed outside the repo:  npm install fontkit@2 --prefix "%TEMP%\wfont"
//   node tools/icons/icon-kit-superset.cjs --family=luminous|google [--add=a,b] [--has=a,b] [--write]
const fs = require('fs');
const os = require('os');
const path = require('path');

const fontkit = require(path.join(os.tmpdir(), 'wfont/node_modules/fontkit'));
const FILE = path.resolve(__dirname, '../../apps/studio/index.html');
const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || '';
const FACES = {
  luminous: { css: 'Luminous Symbols', query: 'Luminous+Symbols:wght@100..700' },
  google: { css: 'Google Symbols', query: 'Google+Symbols:FILL,ROND,wght@0..1,0..100,100..700' },
};
const face = FACES[arg('family') || 'luminous'];
const ADD = arg('add').split(',').filter(Boolean);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

const arr = (v) => (v && typeof v.toArray === 'function' ? v.toArray() : v || []);

function coverageGlyphs(cov) {
  if (cov.glyphs) return arr(cov.glyphs);
  const out = [];
  for (const r of arr(cov.rangeRecords)) for (let g = r.start; g <= r.end; g += 1) out[r.startCoverageIndex + (g - r.start)] = g;
  return out;
}

function ligatureNames(font) {
  const rev = new Map();
  const preferred = (ch) => /[a-z0-9_]/.test(ch);
  for (const cp of font.characterSet) {
    const ch = String.fromCodePoint(cp);
    const id = font.glyphForCodePoint(cp).id;
    if (!rev.has(id) || (preferred(ch) && !preferred(rev.get(id)))) rev.set(id, ch);
  }
  const names = new Set();
  for (const lookup of arr(font.GSUB.lookupList)) {
    for (let sub of arr(lookup.subTables)) {
      let type = lookup.lookupType;
      if (type === 7) { type = sub.lookupType; sub = sub.extension; }
      if (type !== 4) continue;
      const cov = coverageGlyphs(sub.coverage);
      arr(sub.ligatureSets).forEach((set, i) => {
        const first = rev.get(cov[i]);
        for (const lig of arr(set)) {
          const rest = arr(lig.components).map((id) => rev.get(id));
          if (first && rest.every(Boolean)) names.add(first + rest.join(''));
        }
      });
    }
  }
  return names;
}

const fetchFont = async (url) => fontkit.create(Buffer.from(await (await fetch(url, { headers: { 'User-Agent': UA } })).arrayBuffer()));

(async () => {
  const html = fs.readFileSync(FILE, 'utf8');
  const block = html.match(new RegExp(`font-family:\\s*"${face.css}";[\\s\\S]{0,1200}?src:\\s*url\\("([^"]+)"\\)`));
  if (!block) throw new Error(`${face.css} @font-face not found`);
  const before = ligatureNames(await fetchFont(block[1]));
  const icons = [...before].filter((n) => /^[a-z0-9_]+$/.test(n));
  console.log(`${face.css}: current kit has ${before.size} ligatures (${icons.length} icon names)`);
  fs.writeFileSync(path.join(os.tmpdir(), `${arg('family') || 'luminous'}-kit-names.txt`), icons.join('\n'));
  const probe = arg('has').split(',').filter(Boolean);
  if (probe.length) console.log(`has: ${probe.map((n) => `${n}=${before.has(n)}`).join(' ')}`);
  const fresh = ADD.filter((n) => !before.has(n));
  if (!fresh.length) { console.log('nothing to add — every requested icon is already in the kit'); return; }
  /*
   * Past ~4.2K characters of names the endpoint stops subsetting and serves the whole 2.8MB face.
   * A kit's names include aliases the endpoint adds by itself, so ask for the ones the source
   * mentions, then add back whatever the rebuilt kit lost, until it holds every current icon.
   */
  const mentioned = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['node_modules', 'dist', '.git'].includes(e.name)) walk(p); }
      else if (/\.(tsx?|css|html)$/.test(e.name)) for (const m of fs.readFileSync(p, 'utf8').matchAll(/[a-z][a-z0-9_]+/g)) mentioned.add(m[0]);
    }
  };
  for (const r of ['apps', 'features', 'platform']) walk(path.resolve(__dirname, '../..', r));
  let wanted = [...new Set([...icons, ...fresh])].sort();
  let src = null;
  let after = null;
  for (let round = 0; round < 6; round += 1) {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${face.query}&icon_names=${wanted.join(',')}&display=block`, { headers: { 'User-Agent': UA } })).text();
    const hit = css.match(/url\((https:\/\/[^)]+)\)/);
    if (!hit) throw new Error(`endpoint refused the request:\n${css.slice(0, 400)}`);
    if (!hit[1].includes('/l/font?kit=')) {
      console.log(`round ${round}: ${wanted.length} names came back as the full face; asking for the mentioned ones`);
      wanted = [...new Set([...icons.filter((n) => mentioned.has(n)), ...fresh])].sort();
      continue;
    }
    after = ligatureNames(await fetchFont(hit[1]));
    const lost = icons.filter((n) => !after.has(n));
    console.log(`round ${round}: asked ${wanted.length}, kit has ${after.size} ligatures, lost ${lost.length}`);
    if (!lost.length) { src = hit; break; }
    wanted = [...new Set([...wanted, ...lost])].sort();
  }
  if (!src || !after) { console.log('REFUSING: could not build a subset that keeps every current icon'); process.exit(2); }
  const missing = fresh.filter((n) => !after.has(n));
  console.log(`rebuilt kit has ${after.size} ligatures; adds ${fresh.join(', ')}`);
  if (missing.length) {
    console.log(`REFUSING: still missing ${missing.join(', ')}`);
    process.exit(2);
  }
  console.log('verified: every icon in the current kit is in the rebuilt one');
  if (process.argv.includes('--write')) {
    fs.writeFileSync(FILE, fs.readFileSync(FILE, 'utf8').replace(block[1], src[1]));
    console.log('index.html updated');
  } else {
    console.log(src[1]);
  }
})().catch((e) => { console.error('FAILED:', e.stack || e.message); process.exit(1); });
