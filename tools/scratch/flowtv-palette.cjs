// Pulls Flow TV's design-token map (breakpoints, white/black, and the 100-700 palettes channels
// are themed with) out of a cached bundle and prints it as JSON.
//   node tools/scratch/flowtv-palette.cjs
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../ui-research/captures/custom/bundles');
for (const f of fs.readdirSync(dir)) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const at = src.indexOf('e.exports={"mobile-large":"412"');
  if (at < 0) continue;
  const start = src.indexOf('{', at);
  let depth = 0;
  let end = start;
  for (; end < src.length; end += 1) {
    if (src[end] === '{') depth += 1;
    else if (src[end] === '}') { depth -= 1; if (!depth) break; }
  }
  // Keys are bare or quoted; quote the bare ones so JSON can read it.
  const body = src.slice(start, end + 1).replace(/([{,])([A-Za-z_$][\w$-]*):/g, '$1"$2":');
  const map = JSON.parse(body);
  const palettes = {};
  for (const [k, v] of Object.entries(map)) {
    const m = /^([a-z-]+)-(\d00)$/.exec(k);
    if (m && /^\d+,\d+,\d+$/.test(v)) (palettes[m[1]] ??= {})[m[2]] = v;
  }
  console.log(JSON.stringify({ file: f.slice(0, 12), other: Object.fromEntries(Object.entries(map).filter(([k]) => !/-\d00$/.test(k))), palettes }, null, 1));
  break;
}
