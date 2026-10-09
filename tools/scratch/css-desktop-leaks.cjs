/**
 * Lines of a stylesheet's desktop cascade (outside every @media block, comments
 * stripped) that mention a selector — the check `spark-responsive.test.mjs` makes
 * for narrow-only components.
 *
 *   node tools/scratch/css-desktop-leaks.cjs <file.css> <needle>
 */
const fs = require('fs');

const [file, needle] = process.argv.slice(2);
const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
let out = '';
let at = 0;
for (;;) {
  const start = css.indexOf('@media', at);
  if (start === -1) break;
  out += css.slice(at, start);
  let i = css.indexOf('{', start) + 1;
  for (let depth = 1; i < css.length && depth > 0; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') depth -= 1;
  }
  at = i;
}
out += css.slice(at);
const hits = out.split(/\r?\n/).filter((line) => line.includes(needle)).map((line) => line.trim());
console.log(hits.length ? hits.join('\n') : '(none)');
