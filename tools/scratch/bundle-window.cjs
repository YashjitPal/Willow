// Prints a window of a cached Flow bundle (tools/ui-research/captures/flow/bundles/<hash>.js) around
// every match of a regex, or around a byte offset.
//   node tools/scratch/bundle-window.cjs <hash-prefix> <regex|@offset> [before=1500] [after=3000] [max=4]
const fs = require('fs');
const path = require('path');

const [prefix, what, before = '1500', after = '3000', max = '4'] = process.argv.slice(2);
const dir = path.resolve('tools/ui-research/captures/flow/bundles');
const file = fs.readdirSync(dir).find((f) => f.startsWith(prefix));
if (!file) throw new Error(`no bundle starting ${prefix}`);
const src = fs.readFileSync(path.join(dir, file), 'utf8');
const at = [];
if (what.startsWith('@')) at.push(Number(what.slice(1)));
else {
  const re = new RegExp(what, 'g');
  let m;
  while ((m = re.exec(src)) && at.length < Number(max)) at.push(m.index);
}
for (const i of at) {
  console.log(`\n=== ${file} @${i}`);
  console.log(src.slice(Math.max(0, i - Number(before)), i + Number(after)));
}
