// Prints the ancestor chain of the first node in a cdp-kit dump whose tag or class matches a regex.
//   node tools/scratch/dump-ancestors.cjs <dump.json> <regex> [props=comma,list]
const fs = require('fs');

const [file, pattern, propList] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
const re = new RegExp(pattern);
const props = (propList || 'display,width,height,paddingTop,paddingRight,paddingBottom,paddingLeft,gap,rowGap,columnGap,gridTemplateColumns,gridAutoRows,flexWrap,justifyContent,position,overflowY,maxWidth,marginLeft,marginRight').split(',');
const idx = d.nodes.findIndex((n) => re.test(n.tag) || re.test(n.cls || ''));
if (idx < 0) { console.log('no match'); process.exit(0); }
const chain = [d.nodes[idx]];
let depth = d.nodes[idx].d;
for (let i = idx - 1; i >= 0 && depth > 0; i--) {
  if (d.nodes[i].d < depth) { chain.unshift(d.nodes[i]); depth = d.nodes[i].d; }
}
for (const node of chain) {
  const cs = node.cs || {};
  const style = props.filter((p) => cs[p] !== undefined && cs[p] !== '' && cs[p] !== 'normal' && cs[p] !== 'none' && cs[p] !== '0px' && cs[p] !== 'auto').map((p) => `${p}=${cs[p]}`).join(' ');
  const rect = node.rect ? node.rect.map((v) => Math.round(v * 10) / 10).join(',') : '';
  console.log(`${'  '.repeat(node.d)}${node.tag}${node.cls ? `.${node.cls.split(/\s+/).slice(0, 3).join('.')}` : ''} [${rect}]  {${style}}`);
}
