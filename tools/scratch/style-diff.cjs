// Compares computed styles between a Flow dump and a Willow dump, element by element. Each pair is
// `name=flowRegex|willowRegex` (append #n to a regex for its nth match), matched against
// "tag.class1.class2 aria-label text". Prints only the properties that differ.
//   node tools/scratch/style-diff.cjs <flow.json> <willow.json> name=a|b [...] [--props=x,y]
const fs = require('fs');

const args = process.argv.slice(2);
const flow = JSON.parse(fs.readFileSync(args[0], 'utf8'));
const willow = JSON.parse(fs.readFileSync(args[1], 'utf8'));
const propsArg = args.find((a) => a.startsWith('--props='));
const PROPS = propsArg ? propsArg.slice(8).split(',') : [
  'color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'fontVariationSettings',
  'borderTopLeftRadius', 'borderRadius', 'borderTopWidth', 'borderTopColor', 'boxShadow', 'backdropFilter', 'filter', 'opacity',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'gap', 'width', 'height', 'cursor', 'textAlign', 'transitionProperty', 'transitionDuration',
];
const pick = (d, spec) => {
  const m = spec.match(/^(.*)#(\d+)$/);
  const re = new RegExp(m ? m[1] : spec);
  const nth = m ? Number(m[2]) : 0;
  return d.nodes.filter((n) => re.test(`${n.tag}.${(n.cls || '').split(/\s+/).join('.')} ${n.attrs?.['aria-label'] || ''} ${n.text || ''}`))[nth];
};
const norm = (v) => (v === undefined ? '' : String(v).replace(/"/g, '').replace(/\s+/g, ' ').trim());
let differences = 0;
for (const pair of args.slice(2).filter((a) => !a.startsWith('--'))) {
  const at = pair.indexOf('=');
  const name = pair.slice(0, at);
  const [f, w] = pair.slice(at + 1).split('|');
  const a = pick(flow, f);
  const b = pick(willow, w);
  if (!a || !b) { console.log(`${name.padEnd(14)} missing ${a ? '' : 'flow '}${b ? '' : 'willow'}`); differences += 1; continue; }
  const diffs = PROPS.filter((p) => norm(a.cs?.[p]) !== norm(b.cs?.[p])).map((p) => `${p}: flow ${norm(a.cs?.[p]) || '-'} | willow ${norm(b.cs?.[p]) || '-'}`);
  differences += diffs.length;
  console.log(`${name.padEnd(14)} ${diffs.length ? '' : 'same'}`);
  for (const d of diffs) console.log(`    ${d}`);
}
console.log(`\n${differences} difference(s)`);
