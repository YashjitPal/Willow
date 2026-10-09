// Prints each match of a regex in the captured Flow bundles, with context on both sides.
//   node tools/scratch/w-bundle-grep.cjs "<regex>" [context=200] [max=6]
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../ui-research/captures/flow/bundles');
const [pattern, context = '200', max = '6'] = process.argv.slice(2);
const re = new RegExp(pattern, 'g');
let shown = 0;
for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const text = fs.readFileSync(path.join(dir, name), 'utf8');
  for (const m of text.matchAll(re)) {
    const from = Math.max(0, m.index - Number(context));
    console.log(`--- ${name.slice(0, 10)} @${m.index}\n${text.slice(from, m.index + m[0].length + Number(context))}\n`);
    if (++shown >= Number(max)) process.exit(0);
  }
}
if (!shown) console.log('no match');
