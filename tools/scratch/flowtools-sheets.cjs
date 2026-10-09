// List the sections of a cdp-kit stylesheet capture: index, header, size, whether it is an
// Angular component's (scoped) sheet, and its first selectors.
//   node tools/scratch/flowtools-sheets.cjs [file]
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, '../ui-research/captures/flow/tools/stylesheets-all.css');
const text = fs.readFileSync(file, 'utf8');
const parts = text.split(/^(?=\/\* ==== .* ==== \*\/$)/m);
parts.forEach((part, i) => {
  const head = part.split('\n')[0];
  const body = part.slice(head.length);
  const scoped = /_ngcontent-|_nghost-/.test(body);
  const selectors = [...body.matchAll(/^([^@\s{][^{]{0,80})\{/gm)].slice(0, 3).map((m) => m[1].trim());
  console.log(`${String(i).padStart(3)} ${String(body.length).padStart(7)} ${scoped ? 'NG ' : '   '} ${head.slice(8, 70)} :: ${selectors.join(' | ').slice(0, 150)}`);
});
