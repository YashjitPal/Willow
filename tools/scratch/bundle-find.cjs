// Prints the code around each literal occurrence of <text> in the main Flow bundle.
//   node tools/scratch/bundle-find.cjs <text> [before=600] [after=1200] [--max=3] [--file=03-m_wO1vlb.js]
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const [text, before = '600', after = '1200'] = args.filter((a) => !a.startsWith('--'));
const file = opt('file', '03-m_wO1vlb.js');
const max = Number(opt('max', '3'));
const src = fs.readFileSync(path.join(__dirname, '../ui-research/captures/flow/tools/bundles', file), 'utf8');
let at = -1;
let n = 0;
while ((at = src.indexOf(text, at + 1)) >= 0 && n < max) {
  n += 1;
  console.log(`==== @${at}`);
  console.log(src.slice(Math.max(0, at - Number(before)), at + Number(after)));
}
if (!n) console.log('not found');
