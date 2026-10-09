// Summarise a Flow Tools dump (flat cdp-kit node list): an indented outline of the meaningful
// nodes (tag.class, box, own text, img src), skipping layout-only wrappers below a depth limit.
//   node tools/scratch/flowtools-outline.cjs <dump-name> [maxDepth] [rootSelectorClassOrTag]
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const fullClasses = argv.includes('--full');
const [dumpName, maxDepthArg = '40', rootMatch] = argv.filter((a) => a !== '--full');
const file = path.join(__dirname, '../ui-research/captures/flow/tools/dump', `${dumpName}.json`);
const { nodes } = JSON.parse(fs.readFileSync(file, 'utf8'));
const byId = new Map(nodes.map((n) => [n.id, { ...n, kids: [] }]));
for (const n of byId.values()) byId.get(n.p)?.kids.push(n);
const maxDepth = Number(maxDepthArg);

const label = (n) => {
  const r = (n.rect || []).map((v) => Math.round(v)).join(',');
  const src = n.attrs?.src || n.src;
  const extra = [
    n.text ? JSON.stringify(n.text.replace(/\s+/g, ' ').trim().slice(0, 100)) : '',
    src ? `src=${src.slice(0, 120)}` : '',
    n.attrs?.['aria-label'] ? `aria=${JSON.stringify(n.attrs['aria-label'])}` : '',
    n.attrs?.href ? `href=${n.attrs.href.slice(0, 100)}` : '',
  ].filter(Boolean).join(' ');
  const classes = n.cls ? n.cls.trim().split(/\s+/).filter((c) => fullClasses || !/^(ng-|mat-mdc-focus|mdc-.*--|cdk-)/.test(c)) : [];
  return `${n.tag}${classes.length ? `.${(fullClasses ? classes : classes.slice(0, 4)).join('.')}` : ''} [${r}] ${extra}`;
};
const roots = rootMatch
  ? [...byId.values()].filter((n) => n.tag === rootMatch || (n.cls || '').split(/\s+/).includes(rootMatch))
  : [...byId.values()].filter((n) => !byId.has(n.p));
const walk = (n, depth) => {
  if (depth > maxDepth) return;
  console.log(`${'  '.repeat(depth)}${label(n)}`);
  n.kids.forEach((k) => walk(k, depth + 1));
};
roots.forEach((r) => walk(r, 0));
