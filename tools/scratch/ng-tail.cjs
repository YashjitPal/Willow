// Prints the component class of an extracted Angular component (the code around its `Da:` selector).
//   node tools/scratch/ng-tail.cjs <selector> [before=6000] [after=1500]
const fs = require('fs');
const path = require('path');

const [sel, before = '6000', after = '1500'] = process.argv.slice(2);
const src = fs.readFileSync(path.join(__dirname, '../ui-research/captures/flow/tools/ng', `${sel}.js`), 'utf8');
const at = src.lastIndexOf(`Da:[["${sel}"]]`);
const from = Math.max(0, (at < 0 ? src.length : at) - Number(before));
console.log(src.slice(from, (at < 0 ? src.length : at) + Number(after)));
