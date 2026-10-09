/**
 * Diffs two gemini-glow-probe.cjs captures of the same tab: every glow host's own,
 * ::before and ::after computed values, matched by class list. Prints only what changed.
 *
 *   node tools/scratch/glow-probe-diff.cjs <before-label> <after-label> [willow|gemini]
 */
const fs = require('fs');
const path = require('path');

const [a, b, tab = 'willow'] = process.argv.slice(2);
const dir = path.join('tools/ui-research/captures', tab, 'home-glow');
const load = (label) => JSON.parse(fs.readFileSync(path.join(dir, `probe-${label}.json`), 'utf8'));
const key = (h) => `${h.tag}.${(h.cls || '').trim().split(/\s+/).filter((c) => !/^ng-tns-|^ng-star/.test(c)).sort().join('.')}`;
const before = load(a);
const after = load(b);
const index = new Map(after.hosts.map((h) => [key(h), h]));
let changes = 0;
for (const h of before.hosts) {
  const other = index.get(key(h));
  if (!other) { console.log(`- gone: ${key(h)}`); changes += 1; continue; }
  index.delete(key(h));
  for (const part of ['self', 'before', 'after']) {
    for (const [prop, value] of Object.entries(h[part])) {
      if (other[part][prop] !== value) {
        console.log(`${key(h)} ${part}.${prop}\n   was ${value}\n   now ${other[part][prop]}`);
        changes += 1;
      }
    }
  }
  if (JSON.stringify(h.rect) !== JSON.stringify(other.rect)) { console.log(`${key(h)} rect ${h.rect} -> ${other.rect}`); changes += 1; }
}
for (const k of index.keys()) { console.log(`+ new: ${k}`); changes += 1; }
console.log(`${a} -> ${b}: ${changes ? `${changes} differences` : 'identical'}`);
