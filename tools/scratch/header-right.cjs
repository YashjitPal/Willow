// One-off: the header's right-hand controls in a body dump — boxes and paint of every button and
// icon with y < 70 and x > 1100.
//   node tools/scratch/header-right.cjs <dump.json>
const fs = require('fs');

const { nodes } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const n of nodes) {
  if (!n.rect) continue;
  const [x, y, w, h] = n.rect;
  if (y > 70 || x < 1100 || !w || h > 70) continue;
  if (!/^(button|mat-icon|span|img|a)$/.test(n.tag)) continue;
  const label = n.attrs?.['aria-label'] || n.attrs?.title || '';
  const cs = n.cs || {};
  console.log(`${n.tag}.${String(n.cls || '').split(/\s+/).slice(0, 2).join('.')} ${JSON.stringify(n.text || '').slice(0, 20)} [${n.rect.map((v) => Math.round(v * 10) / 10).join(',')}] ${label}`,
    JSON.stringify({ bg: cs.backgroundColor, r: cs.borderRadius, c: cs.color, fs: cs.fontSize, fv: cs.fontVariationSettings }));
}
