// Finds Flow TV CSS-module classes that 06-port-css.cjs would merge: the same module and class
// name under different hashes (two modules that share a file name). Prints each with the bundle
// export map it comes from, when one of the cached bundles has it.
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '../ui-research/captures/flow/tv/assets');
const BUNDLES = path.join(__dirname, '../ui-research/captures/custom/bundles');
const css = fs.readdirSync(ASSETS).filter((f) => f.endsWith('-styles.css')).map((f) => fs.readFileSync(path.join(ASSETS, f), 'utf8')).join('\n');
const byName = new Map();
for (const m of css.matchAll(/\.([a-z0-9-]+)_([A-Za-z0-9-]+)__([A-Za-z0-9_-]{5})\b/g)) {
  const key = `${m[1]}_${m[2]}`;
  if (!byName.has(key)) byName.set(key, new Set());
  byName.get(key).add(m[3]);
}
const bundles = fs.readdirSync(BUNDLES).map((f) => fs.readFileSync(path.join(BUNDLES, f), 'utf8')).join('\n');
const maps = [...bundles.matchAll(/e\.exports=\{[^{}]*?((?:[A-Za-z0-9_$"-]+:"[a-z0-9-]+_[A-Za-z0-9-]+__[A-Za-z0-9_-]{5}",?)+)\}/g)].map((m) => m[1]);
for (const [key, hashes] of byName) {
  if (hashes.size < 2) continue;
  console.log(`${key}: ${[...hashes].join(' ')}`);
  for (const h of hashes) {
    const map = maps.find((m) => m.includes(`${key}__${h}"`));
    console.log(`  ${h}: ${map ? map.replace(/"/g, '').slice(0, 300) : '(no cached bundle map)'}`);
  }
}
