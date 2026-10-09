/**
 * What changed between two cdp-kit dumps of the same subtree: every node (matched by DOM
 * path) whose computed values, ::before/::after values or box differ.
 *
 *   node tools/scratch/dump-diff.cjs <a.json> <b.json> [--props=backgroundColor,opacity]
 */
const fs = require('fs');

const [a, b] = process.argv.slice(2).filter((x) => !x.startsWith('--'));
const only = (process.argv.find((x) => x.startsWith('--props=')) || '').slice(8).split(',').filter(Boolean);
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const A = load(a);
const B = load(b);
const pathOf = (nodes) => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map();
  const label = (n) => `${n.tag}${n.cls ? `.${String(n.cls).trim().split(/\s+/).filter((c) => !/^ng-|^_ng/.test(c)).slice(0, 3).join('.')}` : ''}`;
  const get = (n) => {
    if (memo.has(n.id)) return memo.get(n.id);
    const parent = byId.get(n.p);
    const p = parent ? `${get(parent)} > ${label(n)}` : label(n);
    memo.set(n.id, p);
    return p;
  };
  const out = new Map();
  for (const n of nodes) {
    let key = get(n);
    let i = 1;
    while (out.has(key)) key = `${get(n)}#${i++}`;
    out.set(key, n);
  }
  return out;
};
const pa = pathOf(A.nodes);
const pb = pathOf(B.nodes);
let changes = 0;
const diffObj = (x = {}, y = {}) => {
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  const d = [];
  for (const k of keys) {
    if (only.length && !only.includes(k)) continue;
    if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) d.push(`${k}: ${JSON.stringify(x[k])} -> ${JSON.stringify(y[k])}`);
  }
  return d;
};
for (const [key, n] of pa) {
  const m = pb.get(key);
  if (!m) { if (!only.length) { console.log(`- ${key}`); changes += 1; } continue; }
  const d = [...diffObj(n.cs, m.cs), ...diffObj(n.before, m.before).map((s) => `::before ${s}`), ...diffObj(n.after, m.after).map((s) => `::after ${s}`)];
  if (!only.length && JSON.stringify(n.rect) !== JSON.stringify(m.rect)) d.push(`rect ${JSON.stringify(n.rect)} -> ${JSON.stringify(m.rect)}`);
  if (d.length) { console.log(`${key}\n   ${d.join('\n   ')}`); changes += 1; }
}
if (!only.length) for (const key of pb.keys()) if (!pa.has(key)) { console.log(`+ ${key}`); changes += 1; }
console.log(`${changes} nodes differ`);
