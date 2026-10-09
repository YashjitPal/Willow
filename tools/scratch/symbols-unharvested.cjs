// Which of these glyph names does the subset harvest miss? Prints the ones the harvest in
// symbols-subset-headless.cjs does not find as quoted strings (names under three letters, names
// built at runtime), and where, if anywhere, each appears in the source, so it can be kept with
// --add= or SHORT_NAMES. symbols-dropped.cjs asks the served face instead.
//   node tools/scratch/symbols-unharvested.cjs name1,name2,...
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../..');
const names = (process.argv[2] || '').split(',').filter(Boolean);
const quoted = new Set();
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'dist', '.git'].includes(e.name)) walk(p); }
    else if (/\.(tsx?|css|html)$/.test(e.name)) files.push(p);
  }
};
for (const r of ['apps', 'features', 'platform']) walk(path.join(REPO, r));
const sources = files.map((f) => [f, fs.readFileSync(f, 'utf8')]);
for (const [, src] of sources) {
  const re = /['"`]([a-z][a-z0-9_]{2,30})['"`]/g;
  let m;
  while ((m = re.exec(src))) quoted.add(m[1]);
}
for (const n of names) {
  if (quoted.has(n)) continue;
  const hits = sources.filter(([, src]) => new RegExp(`\\b${n}\\b`).test(src)).map(([f]) => path.relative(REPO, f));
  console.log(`${n}: not harvested; mentioned in ${hits.length ? hits.slice(0, 4).join(', ') : 'nothing'}`);
}
