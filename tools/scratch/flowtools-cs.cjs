// Computed styles of the dumped nodes whose class matches a regex: Flow's real cascade outcome.
//   node tools/scratch/flowtools-cs.cjs <dump> <class regex> [props,comma,separated]
const fs = require('fs');
const path = require('path');

const [dump, pattern, props = 'backgroundColor,color,borderRadius,width,height'] = process.argv.slice(2);
const json = JSON.parse(fs.readFileSync(path.join(__dirname, '../ui-research/captures/flow/tools/dump', `${dump}.json`), 'utf8'));
const nodes = json.nodes || json;
const re = new RegExp(pattern);
const keys = props.split(',');
for (const n of nodes) {
  if (!re.test(n.cls || '')) continue;
  const cs = n.cs || {};
  console.log(`${n.tag}.${(n.cls || '').split(' ').filter((c) => re.test(c) || /flow-|mat-/.test(c)).slice(0, 6).join('.')}  ${keys.map((k) => `${k}=${cs[k]}`).join('  ')}`);
}
