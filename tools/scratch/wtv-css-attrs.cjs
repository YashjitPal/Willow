// Lists, per CSS module of willow-tv.css, the data attributes its selectors test and the custom
// properties its declarations read, so components can set every state hook the port expects.
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../../features/media/src/tv/willow-tv.css'), 'utf8');
const byModule = new Map();
const add = (mod, kind, v) => {
  if (!byModule.has(mod)) byModule.set(mod, { attrs: new Set(), vars: new Set(), classes: new Set() });
  byModule.get(mod)[kind].add(v);
};
const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
let m;
while ((m = ruleRe.exec(css))) {
  const sel = m[1].trim();
  const body = m[2];
  if (sel.startsWith('@')) continue;
  const mods = [...sel.matchAll(/\.wtv-([a-z0-9-]+)__([A-Za-z0-9_-]+)/g)];
  const owner = mods.length ? mods[mods.length - 1][1] : '(global)';
  for (const c of mods) add(c[1], 'classes', c[2]);
  for (const a of sel.matchAll(/\[(data-[a-z0-9-]+)(?:="([^"]*)")?\]/g)) add(owner, 'attrs', a[2] !== undefined ? `${a[1]}=${a[2]}` : a[1]);
  for (const v of body.matchAll(/var\((--[a-z0-9-]+)/g)) add(owner, 'vars', v[1]);
}
const only = process.argv.slice(2);
for (const [mod, s] of [...byModule].sort(([a], [b]) => a.localeCompare(b))) {
  if (only.length && !only.includes(mod)) continue;
  console.log(`## ${mod}`);
  console.log(`  classes: ${[...s.classes].sort().join(' ')}`);
  if (s.attrs.size) console.log(`  attrs: ${[...s.attrs].sort().join(' ')}`);
  if (s.vars.size) console.log(`  vars: ${[...s.vars].sort().join(' ')}`);
}
