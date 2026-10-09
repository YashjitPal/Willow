// Prints the subtree of the first node whose class list contains <needle> from a cdp-kit dump.
//   node tools/scratch/dump-subtree.cjs <dump.json> <classNeedle> [props=comma,list] [nth=0]
const fs = require('fs');

const [file, needle, propList, nth = '0'] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
const props = (propList || 'display,width,height,paddingTop,paddingRight,paddingBottom,paddingLeft,gap,backgroundColor,color,fontSize,fontWeight,lineHeight,borderRadius,border,boxShadow').split(',');
const hits = d.nodes.map((node, i) => ({ node, i })).filter(({ node }) => (node.cls || '').split(/\s+/).includes(needle) || (node.tag === needle));
const hit = hits[Number(nth)];
if (!hit) { console.log(`no node with class ${needle} (${hits.length} hits)`); process.exit(0); }
const base = hit.node.d;
for (let i = hit.i; i < d.nodes.length; i += 1) {
  const node = d.nodes[i];
  if (i > hit.i && node.d <= base) break;
  const pad = '  '.repeat(node.d - base);
  const cls = (node.cls || '').split(/\s+/).filter(Boolean).slice(0, 4).join('.');
  const rect = node.rect ? node.rect.map((v) => Math.round(v * 10) / 10).join(',') : '';
  const cs = node.cs || {};
  const style = props.filter((p) => cs[p] !== undefined && cs[p] !== '' && cs[p] !== 'normal' && cs[p] !== 'none' && cs[p] !== '0px' && cs[p] !== 'auto' && !(p === 'display' && cs[p] === 'block')).map((p) => `${p}=${cs[p]}`).join(' ');
  const attrs = node.attrs ? Object.entries(node.attrs).filter(([k]) => /aria-label|aria-checked|role|type|data-mat-icon-name|href|src/.test(k)).map(([k, v]) => `${k}="${String(v).slice(0, 90)}"`).join(' ') : '';
  console.log(`${pad}${node.tag}${cls ? `.${cls}` : ''} [${rect}]${node.text ? ` "${node.text.slice(0, 80)}"` : ''}${attrs ? ` ${attrs}` : ''}${style ? `  {${style}}` : ''}`);
}
