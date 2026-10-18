/**
 * Prints the text around each hit of <needle> in the cached Gemini bundles (captures/gemini/bundles), first hit
 * per file unless --all, with <before>/<after> characters of context.
 *
 *   node tools/scratch/bundle-near.cjs <needle> [before=300] [after=2500] [--all]
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const all = args.includes('--all');
const [needle, before = '300', after = '2500'] = args.filter((a) => a !== '--all');
const dir = path.join(__dirname, '..', 'ui-research', 'captures', 'gemini', 'bundles');
const seen = new Set();
for (const name of fs.readdirSync(dir)) {
  const file = path.join(dir, name);
  if (!fs.statSync(file).isFile()) continue;
  const text = fs.readFileSync(file, 'utf8');
  let i = text.indexOf(needle);
  while (i >= 0) {
    const chunk = text.slice(Math.max(0, i - Number(before)), i + Number(after));
    if (!seen.has(chunk)) {
      seen.add(chunk);
      console.log(`== ${name} @ ${i}\n${chunk}\n`);
    }
    if (!all) break;
    i = text.indexOf(needle, i + 1);
  }
}
