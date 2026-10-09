// For every Angular component whose selector matches a pattern, write its region (from the end
// of the previous component definition to the end of its own) to captures/flow/tools/ng/<sel>.js,
// re-wrapped for reading, and its ordered string literals (styles excluded) to <sel>.txt.
//   node tools/scratch/ng-all.cjs [selectorRegex]
const fs = require('fs');
const path = require('path');

const pattern = new RegExp(process.argv[2] || '^flow-(applet|community|tool|soupy|chat-scroller|editable-text|markdown|toggles|footer-disclaimer|navigation-header|project-nav|sidenav)');
const dir = path.join(__dirname, '../ui-research/captures/flow/tools/bundles');
const out = path.join(__dirname, '../ui-research/captures/flow/tools/ng');
fs.mkdirSync(out, { recursive: true });
let count = 0;

// End of the `_.w({...})` call that starts at `at` (".La=_.w("): bracket matching that skips
// string and template literals.
const defEnd = (src, at) => {
  let i = src.indexOf('(', at) + 1;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i += 1;
      while (i < src.length && src[i] !== ch) i += src[i] === '\\' ? 2 : 1;
    } else if (ch === '(' || ch === '{' || ch === '[') depth += 1;
    else if (ch === ')' || ch === '}' || ch === ']') depth -= 1;
    i += 1;
  }
  return i;
};

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const defs = [...src.matchAll(/\.La=_\.w\(\{type:[\w$.]+,Da:\[\["([a-z][\w-]*)"/g)].map((m) => ({ sel: m[1], at: m.index }));
  defs.forEach((d, i) => {
    if (!pattern.test(d.sel)) return;
    const start = i > 0 ? defEnd(src, defs[i - 1].at) : Math.max(0, d.at - 40000);
    const end = defEnd(src, d.at);
    const region = src.slice(start, end);
    fs.writeFileSync(path.join(out, `${d.sel}.js`), `// ${f} [${start}, ${end})\n${region.replace(/([;{}])(?=[a-zA-Z_$])/g, '$1\n')}\n`);
    const noStyles = region.replace(/styles:\['[\s\S]*$/, '');
    const strs = [...noStyles.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1] ?? m[2]).filter((s) => s && /[A-Za-z]{2}/.test(s));
    fs.writeFileSync(path.join(out, `${d.sel}.txt`), strs.filter((s, k) => s !== strs[k - 1]).join('\n'));
    count += 1;
  });
}
console.log(`${count} components -> ${out}`);
