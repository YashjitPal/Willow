// Prints the distinct string literals in a cached Flow bundle that match a regex (case-insensitive).
//   node tools/scratch/bundle-strings.cjs <hash-prefix> <regex> [max=80]
const fs = require('fs');
const path = require('path');

const [prefix, pattern, max = '80'] = process.argv.slice(2);
const dir = path.resolve('tools/ui-research/captures/flow/bundles');
const file = fs.readdirSync(dir).find((f) => f.startsWith(prefix));
const src = fs.readFileSync(path.join(dir, file), 'utf8');
const want = new RegExp(pattern, 'i');
const literal = /"((?:[^"\\]|\\.){3,300})"|'((?:[^'\\]|\\.){3,300})'|`((?:[^`\\]|\\.){3,300})`/g;
const seen = new Set();
let m;
while ((m = literal.exec(src)) && seen.size < Number(max)) {
  const text = m[1] ?? m[2] ?? m[3];
  if (!want.test(text) || seen.has(text)) continue;
  seen.add(text);
  console.log(`@${m.index} ${text}`);
}
