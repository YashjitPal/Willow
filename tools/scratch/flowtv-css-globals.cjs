// Lists the rules in the captured Flow TV stylesheets that are not a CSS-module class's (resets,
// :root variables, fonts, html/body), i.e. the ones the port has to place by hand.
//   node tools/scratch/flowtv-css-globals.cjs
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../ui-research/captures/flow/tv/assets');
const MODULE = /\.[a-z0-9-]+_[A-Za-z0-9]+__[A-Za-z0-9_-]{5}/;
const seen = new Set();
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('-styles.css'))) {
  for (const rule of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
    if (!rule.trim() || seen.has(rule)) continue;
    seen.add(rule);
    if (MODULE.test(rule)) continue;
    console.log(rule.slice(0, 400));
  }
}
console.log(`\n${seen.size} distinct rule lines`);
