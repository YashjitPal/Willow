// The class names and literal attributes in an extracted component's template consts (`Ma:`),
// in order: a quick map of its DOM when the strings file is too noisy.
//   node tools/scratch/ng-consts.cjs <selector> [filter regex]
const fs = require('fs');
const path = require('path');

const [sel, filter] = process.argv.slice(2);
const src = fs.readFileSync(path.join(__dirname, '../ui-research/captures/flow/tools/ng', `${sel}.js`), 'utf8');
const at = src.indexOf('Ma:()=>');
const end = src.indexOf('template:function', at);
const consts = src.slice(at, end > 0 ? end : at + 20000);
const re = filter ? new RegExp(filter, 'i') : null;
const groups = [...consts.matchAll(/\[(?:"[^"]*"|[\d,]|\s)*?(?:1,("[^"]+"(?:,"[^"]+")*))(?:,[^\]]*)?\]/g)]
  .map((m) => m[1].replace(/"/g, ''));
const seen = new Set();
for (const g of groups) {
  if (seen.has(g) || (re && !re.test(g))) continue;
  seen.add(g);
  console.log(g);
}
