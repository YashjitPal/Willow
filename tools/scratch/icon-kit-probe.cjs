// Why does the css2 endpoint serve the full Google Symbols face for the current kit's names?
// Tries the current names alone, and halves, reporting subset vs full for each request.
const fs = require('fs');
const path = require('path');

const fontkit = require(path.join(process.env.TEMP, 'wfont/node_modules/fontkit'));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const QUERY = 'Google+Symbols:FILL,ROND,wght@0..1,0..100,100..700';
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

const ask = async (names) => {
  const url = `https://fonts.googleapis.com/css2?family=${QUERY}&icon_names=${names.join(',')}&display=block`;
  const css = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
  const src = css.match(/url\((https:\/\/[^)]+)\)/);
  return { len: url.length, kind: !src ? `refused: ${css.slice(0, 80)}` : src[1].includes('/l/font?kit=') ? 'subset' : 'FULL' };
};

(async () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../apps/studio/index.html'), 'utf8');
  const cur = html.match(/font-family:\s*"Google Symbols";[\s\S]{0,1200}?src:\s*url\("([^"]+)"\)/)[1];
  const font = fontkit.create(Buffer.from(await (await fetch(cur, { headers: { 'User-Agent': UA } })).arrayBuffer()));
  const names = [...ligatureNames(font)].sort();
  console.log('current names', names.length);
  console.log('all', JSON.stringify(await ask(names)));
  const half = Math.ceil(names.length / 2);
  console.log('first half', JSON.stringify(await ask(names.slice(0, half))));
  console.log('second half', JSON.stringify(await ask(names.slice(half))));
  console.log('three new only', JSON.stringify(await ask(['chat_spark_2', 'record_voice_over', 'voice_over_off'])));
  fs.writeFileSync(path.join(__dirname, 'google-kit-names.txt'), names.join('\n'));
})().catch((e) => { console.error('FAILED:', e.stack || e.message); process.exit(1); });
