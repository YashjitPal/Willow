// Where the ported Tools CSS defines each custom property, and which used ones it never defines.
//   node tools/scratch/flowtools-vars.cjs [--undefined] [name ...]
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../../features/media/src/tools/flow-tools.css'), 'utf8');
const args = process.argv.slice(2);
const defined = new Map();
for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
  if (!defined.has(m[1])) defined.set(m[1], []);
  defined.get(m[1]).push(m[2].trim());
}
if (args.includes('--undefined')) {
  const used = new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]));
  const missing = [...used].filter((v) => !defined.has(v)).sort();
  console.log(`${missing.length} used but never defined:\n${missing.join('\n')}`);
} else {
  for (const name of args) console.log(`${name}: ${(defined.get(name) ?? ['(undefined)']).slice(-2).join(' | ').slice(0, 160)}`);
}
