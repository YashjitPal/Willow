// Prints a cdp-kit dump as an indented tree: tag.class, rect, text, and chosen computed styles.
//   node tools/scratch/dump-print.cjs <dump.json> [maxDepth=40] [props=comma,list] [maxNodes=400]
const fs = require('fs');

const [file, maxDepth = '40', propList, maxNodes = '400'] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
const props = (propList || 'display,width,height,paddingTop,paddingRight,paddingBottom,paddingLeft,marginTop,marginBottom,gap,gridTemplateColumns,flexDirection,alignItems,justifyContent,backgroundColor,color,fontFamily,fontSize,fontWeight,lineHeight,letterSpacing,borderRadius,boxShadow,backdropFilter,opacity,position,overflowX,overflowY,cursor,whiteSpace,textOverflow,fontVariationSettings,transitionProperty,transitionDuration').split(',');
const depth0 = d.nodes[0]?.d ?? 0;
let n = 0;
for (const node of d.nodes) {
  if (node.d - depth0 > Number(maxDepth)) continue;
  if (n++ > Number(maxNodes)) { console.log('...'); break; }
  const pad = '  '.repeat(node.d - depth0);
  const cls = (node.cls || '').split(/\s+/).filter(Boolean).slice(0, 4).join('.');
  const rect = node.rect ? node.rect.map((v) => Math.round(v * 10) / 10).join(',') : '';
  const cs = node.cs || {};
  const style = props.filter((p) => cs[p] !== undefined && cs[p] !== '' && cs[p] !== 'normal' && cs[p] !== 'none' && cs[p] !== '0px' && cs[p] !== 'auto' && !(p === 'display' && cs[p] === 'block')).map((p) => `${p}=${cs[p]}`).join(' ');
  const attrs = node.attrs ? Object.entries(node.attrs).filter(([k]) => /aria-label|role|type|mattooltip|data-mat-icon/.test(k)).map(([k, v]) => `${k}="${String(v).slice(0, 40)}"`).join(' ') : '';
  console.log(`${pad}${node.tag}${cls ? `.${cls}` : ''} [${rect}]${node.text ? ` "${node.text.slice(0, 60)}"` : ''}${attrs ? ` ${attrs}` : ''}${style ? `  {${style}}` : ''}`);
}
