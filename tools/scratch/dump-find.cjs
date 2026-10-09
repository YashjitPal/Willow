// Prints the rect (and chosen computed styles) of the first node in a cdp-kit dump matching each
// `name=regex` pair, matched against "tag.class1.class2 aria-label text".
//   node tools/scratch/dump-find.cjs <dump.json> name=regex [name=regex ...] [--props=a,b]
const fs = require('fs');

const args = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(args[0], 'utf8'));
const propsArg = args.find((a) => a.startsWith('--props='));
const props = propsArg ? propsArg.slice(8).split(',') : [];
const nthArg = (spec) => { const m = spec.match(/^(.*)#(\d+)$/); return m ? [m[1], Number(m[2])] : [spec, 0]; };
for (const pair of args.slice(1).filter((a) => !a.startsWith('--'))) {
  const at = pair.indexOf('=');
  const name = pair.slice(0, at);
  const [src, nth] = nthArg(pair.slice(at + 1));
  const re = new RegExp(src);
  const hits = d.nodes.filter((n) => re.test(`${n.tag}.${(n.cls || '').split(/\s+/).join('.')} ${n.attrs?.['aria-label'] || ''} ${n.text || ''}`));
  const n = hits[nth];
  if (!n) { console.log(`${name.padEnd(15)} -`); continue; }
  const rect = n.rect ? n.rect.map((v) => Math.round(v * 10) / 10).join(',') : '';
  const cs = props.map((p) => `${p}=${n.cs?.[p] ?? ''}`).join(' ');
  console.log(`${name.padEnd(15)} ${rect}${cs ? `  ${cs}` : ''}`);
}
