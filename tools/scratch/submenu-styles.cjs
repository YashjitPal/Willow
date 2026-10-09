// One-off: the nodes of the LAST menu panel in a cdk-kit overlay dump (a submenu), with geometry and
// the box/type properties that size a row.
//   node tools/scratch/submenu-styles.cjs <dump.json> [maxDepthBelowPanel]
const d = require(require('path').resolve(process.argv[2]));
const maxDepth = Number(process.argv[3] || 6);
const nodes = d.nodes;
const byId = new Map(nodes.map((n) => [n.id, n]));
const panels = nodes.filter((n) => /mat-mdc-menu-panel/.test(n.cls || ''));
const panel = panels[panels.length - 1];
const under = (n) => { for (let p = n; p; p = byId.get(p.p)) if (p === panel) return true; return false; };
const KEYS = ['display', 'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginBottom', 'gap', 'columnGap', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'backgroundColor', 'borderRadius', 'boxShadow', 'backdropFilter', 'border', 'borderTop'];
for (const n of nodes.filter(under)) {
  if (n.d - panel.d > maxDepth) continue;
  const cs = Object.fromEntries(KEYS.filter((k) => n.cs && n.cs[k] !== undefined).map((k) => [k, n.cs[k]]));
  console.log(`${'  '.repeat(n.d - panel.d)}${n.tag}.${(n.cls || '').split(' ').slice(0, 3).join('.')} [${n.rect.map((v) => Math.round(v * 100) / 100).join(', ')}] ${n.text ? JSON.stringify(n.text).slice(0, 40) : ''}`);
  console.log(`${'  '.repeat(n.d - panel.d)}  ${JSON.stringify(cs)}`);
}
