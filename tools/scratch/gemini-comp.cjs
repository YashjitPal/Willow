// A compiled Angular component's template and styles from the cached GEMINI bundles, readable:
// the template code, then the CSS one rule per line with vendor prefixes and scoping stripped.
// Searches every cached bundle for the component's selector.
//   node tools/scratch/gemini-comp.cjs <component-tag> [templateChars=4000] [filter-regex]
const fs = require('fs');
const path = require('path');

const [tag, tplChars = '4000', filter] = process.argv.slice(2);
const dir = path.resolve('tools/ui-research/captures/gemini/bundles');
let src = null;
let file = null;
let at = -1;
for (const f of fs.readdirSync(dir)) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  const i = text.indexOf(`Na:[["${tag}"`);
  if (i >= 0) { src = text; file = f; at = i; break; }
}
if (!src) throw new Error(`no component ${tag} in ${dir}`);
console.log(`(${file} @${at})`);
const tpl = src.indexOf('template:', at);
const styles = src.indexOf('styles:', tpl);
console.log('---- CONSTS + TEMPLATE ----');
const consts = src.indexOf('Sa:', at);
console.log(src.slice(consts > 0 && consts < tpl ? consts : tpl, Math.min(styles > 0 ? styles : tpl + Number(tplChars), tpl + Number(tplChars))));
if (styles < 0 || styles - tpl > 60000) { console.log('---- NO STYLES ----'); process.exit(0); }
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
  .replace(/\\n/g, '\n')
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
