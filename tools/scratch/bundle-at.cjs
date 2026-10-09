// Prints windows of any cached bundle (tools/ui-research/captures/*/bundles/<hash>.js) around each
// match of a regex.
//   node tools/scratch/bundle-at.cjs <hash-prefix> <regex> [before=600] [after=1200] [max=6]
const fs = require('fs');
const path = require('path');

const [prefix, what, before = '600', after = '1200', max = '6'] = process.argv.slice(2);
const root = path.resolve('tools/ui-research/captures');
const dirs = fs.readdirSync(root).map((d) => path.join(root, d, 'bundles')).filter((d) => fs.existsSync(d));
const hit = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.startsWith(prefix)).map((f) => path.join(d, f)))[0];
if (!hit) throw new Error(`no bundle starting ${prefix}`);
const src = fs.readFileSync(hit, 'utf8');
const re = new RegExp(what, 'g');
let m;
let n = 0;
while ((m = re.exec(src)) && n < Number(max)) {
  n += 1;
  console.log(`\n=== ${path.basename(hit)} @${m.index}`);
  console.log(src.slice(Math.max(0, m.index - Number(before)), m.index + Number(after)));
}
if (!n) console.log('no match');
