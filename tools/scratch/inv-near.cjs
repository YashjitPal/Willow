/**
 * From two saved page-inventory captures, prints every item within a vertical window below
 * an anchor text, positioned relative to the anchor: a quick way to compare the inside of one
 * card when the cards themselves sit at different heights in the two apps.
 *
 *   node tools/scratch/inv-near.cjs <label> "<anchor text>" [windowPx=260] [--rename=Gemini=Willow]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const [label, anchor, windowArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const renameArg = process.argv.find((a) => a.startsWith('--rename='));
const [from, to] = renameArg ? renameArg.slice(9).split('=') : [null, null];
const span = Number(windowArg || 260);
const dir = path.join(os.tmpdir(), 'willow-emulator');

for (const app of ['gemini', 'willow']) {
  const file = path.join(dir, `inv-${app}-${label}.json`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const items = data.items || data;
  const wanted = app === 'gemini' || !from ? anchor : anchor.split(from).join(to);
  const hit = items.find((item) => String(item.text || '').startsWith(wanted));
  if (!hit) {
    console.log(`${app}: no "${wanted}"`);
    continue;
  }
  const [ax, ay] = hit.rect;
  console.log(`${app}: anchor "${wanted}" at [${hit.rect.join(',')}]`);
  for (const item of items) {
    const [x, y, w, h] = item.rect;
    if (y < ay - 4 || y > ay + span || x < ax - 40) continue;
    const text = String(item.text || '').replace(/\s+/g, ' ').slice(0, 34);
    console.log(`  ${(item.kind || '').padEnd(5)} dx${String(Math.round((x - ax) * 10) / 10).padStart(6)} dy${String(Math.round((y - ay) * 10) / 10).padStart(7)} w${w} h${h}  "${text}"`);
  }
}
