// Every Angular component in a cached bundle with its selector and its `styles`, one readable CSS
// file per component.
//   node tools/scratch/bundle-styles.cjs <hash-prefix> <out-dir>
const fs = require('fs');
const path = require('path');

const [prefix, outDir] = process.argv.slice(2);
const root = path.resolve('tools/ui-research/captures');
const dirs = fs.readdirSync(root).map((d) => path.join(root, d, 'bundles')).filter((d) => fs.existsSync(d));
const file = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.startsWith(prefix)).map((f) => path.join(d, f)))[0];
if (!file) throw new Error(`no bundle starting ${prefix}`);
const src = fs.readFileSync(file, 'utf8');
fs.mkdirSync(outDir, { recursive: true });

// A JS string literal starting at `at` (a quote), returned decoded, plus where it ends.
const readString = (at) => {
  const quote = src[at];
  let i = at + 1;
  let out = '';
  while (i < src.length && src[i] !== quote) {
    if (src[i] === '\\') { out += src[i + 1] === 'n' ? '\n' : src[i + 1]; i += 2; } else { out += src[i]; i += 1; }
  }
  return { value: out, end: i + 1 };
};

const pretty = (css) => css
  .replace(/\[_ngcontent-%COMP%\]/g, '')
  .replace(/\[_nghost-%COMP%\]/g, ':host')
  .replace(/%NS%/g, '')
  .replace(/\{/g, ' {\n  ')
  .replace(/;(?=[^\n])/g, ';\n  ')
  .replace(/\}/g, '\n}\n')
  .replace(/\n {2}\n/g, '\n');

let n = 0;
const re = /styles:\[/g;
let m;
while ((m = re.exec(src))) {
  let i = m.index + m[0].length;
  const parts = [];
  while (src[i] === '"' || src[i] === "'") {
    const s = readString(i);
    parts.push(s.value);
    i = s.end;
    if (src[i] === ',') i += 1;
  }
  if (!parts.length) continue;
  // The selector is declared earlier in the same definition: Da:[["tag"]] or similar.
  const head = src.slice(Math.max(0, m.index - 40000), m.index);
  const sel = [...head.matchAll(/\[\["([a-z][a-z0-9-]*)"\]\]/g)].pop()?.[1] || `component-${n}`;
  const name = `${sel}.css`;
  fs.writeFileSync(path.join(outDir, name), pretty(parts.join('\n')));
  console.log(`${name}  ${parts.join('').length} chars`);
  n += 1;
}
console.log(`${n} components`);
