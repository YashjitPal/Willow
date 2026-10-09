// Prints the CSS rules whose selector mentions a word, from one stylesheet.
//   node tools/scratch/w-css-rules.cjs <file.css> <word> [max=12]
const fs = require('fs');

const [file, word, max = '12'] = process.argv.slice(2);
const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
let shown = 0;
let depth = 0;
let start = 0;
for (let i = 0; i < css.length && shown < Number(max); i++) {
  if (css[i] === '{') {
    if (depth === 0 || /@media|@supports|@layer/.test(css.slice(start, i))) {
      const selector = css.slice(start, i).trim();
      const end = css.indexOf('}', i);
      if (!selector.startsWith('@') && selector.includes(word)) {
        console.log(`${selector.slice(0, 220)} { ${css.slice(i + 1, end).trim().slice(0, 400)} }`);
        shown += 1;
      }
      if (!selector.startsWith('@')) { i = end; start = end + 1; continue; }
    }
    depth += 1;
    start = i + 1;
  } else if (css[i] === '}') {
    depth = Math.max(0, depth - 1);
    start = i + 1;
  }
}
if (!shown) console.log('no rule');
