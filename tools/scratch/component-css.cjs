// A compiled Angular component's template and styles from a cached Flow bundle, readable: the
// template code, then the CSS one rule per line with vendor prefixes and the scoping attribute
// stripped.
//   node tools/scratch/component-css.cjs <hash-prefix> <component-tag> [templateChars=4000] [filter-regex]
const fs = require('fs');
const path = require('path');

const [prefix, tag, tplChars = '4000', filter] = process.argv.slice(2);
const dir = path.resolve('tools/ui-research/captures/flow/bundles');
const file = fs.readdirSync(dir).find((f) => f.startsWith(prefix));
const src = fs.readFileSync(path.join(dir, file), 'utf8');
const at = src.indexOf(`[["${tag}"]]`);
if (at < 0) throw new Error(`no component ${tag}`);
const tpl = src.indexOf('template:', at);
const styles = src.indexOf('styles:', tpl);
console.log('---- TEMPLATE ----');
console.log(src.slice(tpl, Math.min(styles, tpl + Number(tplChars))));
const open = src.indexOf('[', styles);
let depth = 0;
let end = open;
let inStr = null;
for (let i = open; i < src.length; i += 1) {
  const ch = src[i];
  if (inStr) {
    if (ch === '\\') { i += 1; continue; }
    if (ch === inStr) inStr = null;
    continue;
  }
  if (ch === '"' || ch === "'") { inStr = ch; continue; }
  if (ch === '[') depth += 1;
  if (ch === ']') { depth -= 1; if (depth === 0) { end = i; break; } }
}
const css = src.slice(open + 1, end)
  .replace(/\[_ngcontent-%COMP%\]/g, '')
  .replace(/\[_nghost-%COMP%\]/g, ':host')
  .replace(/--%NS%/g, '--')
  .replace(/(-webkit-|-moz-|-ms-)[a-z-]+:[^;{}]+;?/g, '')
  .replace(/display:-webkit-[a-z-]+;|display:-moz-[a-z-]+;|display:-ms-[a-z-]+;/g, '');
const re = filter ? new RegExp(filter) : null;
console.log('---- STYLES ----');
for (const rule of css.split('}')) {
  const r = rule.trim();
  if (!r || r === "'" || r === '"') continue;
  if (re && !re.test(r)) continue;
  console.log(`${r}}`);
}
