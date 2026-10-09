/*
 * Pairs two page-inventory.cjs captures element by element (same kind and text, in reading
 * order, then by icon name) and prints only what differs: box, glyph box, type, colour and
 * the surface under each element. Unmatched elements on either side are listed too.
 *
 *   node tools/scratch/inventory-diff.cjs <geminiLabel> <willowLabel> [--tol=0.6] [--rename="Gemini=Willow"]...
 *
 * --rename maps a Gemini string onto Willow's equivalent when the copy deliberately differs.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const tol = Number((args.find((a) => a.startsWith('--tol=')) || '--tol=0.6').slice(6));
const renames = Object.fromEntries(args.filter((a) => a.startsWith('--rename=')).map((a) => a.slice(9).split('=')));
const [gLabel, wLabel] = args.filter((a) => !a.startsWith('--'));
const load = (app, label) => JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'willow-emulator', `inv-${app}-${label}.json`), 'utf8'));
const g = load('gemini', gLabel);
const w = load('willow', wLabel);

const key = (item, map) => `${item.kind}:${map[item.text] ?? item.text}`;
const pool = new Map();
for (const item of w.items) {
  const k = key(item, {});
  if (!pool.has(k)) pool.set(k, []);
  pool.get(k).push(item);
}
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
let diffs = 0;
const unmatched = [];
console.log(`== gemini ${g.viewport}  vs  willow ${w.viewport}`);
for (const item of g.items) {
  const candidates = pool.get(key(item, renames));
  if (!candidates || !candidates.length) { unmatched.push(item); continue; }
  const match = candidates.shift();
  const out = [];
  if (!near(item.rect, match.rect)) out.push(`rect ${JSON.stringify(item.rect)} -> ${JSON.stringify(match.rect)}`);
  if (item.glyphs && match.glyphs && !near(item.glyphs, match.glyphs)) out.push(`glyphs x${item.glyphs[0]} w${item.glyphs[2]} -> x${match.glyphs[0]} w${match.glyphs[2]}`);
  for (const f of ['size', 'lh', 'weight', 'color']) if (item[f] !== match[f]) out.push(`${f} ${item[f]} -> ${match[f]}`);
  if (item.kind === 'text' && item.axes !== match.axes) out.push(`axes ${item.axes} -> ${match.axes}`);
  const gs = item.surface; const ws = match.surface;
  if (gs && ws) {
    if (!near(gs.rect, ws.rect)) out.push(`surface ${gs.tag}${JSON.stringify(gs.rect)} -> ${ws.tag}${JSON.stringify(ws.rect)}`);
    for (const f of ['bg', 'radius', 'border', 'padding']) if (gs[f] !== ws[f]) out.push(`surface.${f} ${gs[f] || '-'} -> ${ws[f] || '-'}`);
  } else if (gs || ws) out.push(`surface ${gs ? gs.tag : 'none'} -> ${ws ? ws.tag : 'none'}`);
  if (out.length) {
    diffs += 1;
    console.log(`\n${item.kind.toUpperCase()} "${item.text}"`);
    for (const line of out) console.log(`   ${line}`);
  }
}
const leftovers = [...pool.values()].flat();
if (unmatched.length) {
  console.log('\n-- only in Gemini:');
  for (const item of unmatched) console.log(`   ${item.kind} "${item.text}" [${item.rect.join(',')}] ${item.size} ${item.color}`);
}
if (leftovers.length) {
  console.log('\n-- only in Willow:');
  for (const item of leftovers) console.log(`   ${item.kind} "${item.text}" [${item.rect.join(',')}] ${item.size} ${item.color}`);
}
console.log(`\n${diffs} differing pair(s), ${unmatched.length} Gemini-only, ${leftovers.length} Willow-only`);
