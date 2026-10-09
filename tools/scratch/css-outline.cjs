/**
 * Prints a stylesheet's rules as one line each (comments stripped), optionally only
 * those whose body mentions a layout property, with media blocks labelled.
 *
 *   node tools/scratch/css-outline.cjs <file.css> [--layout] [--max=80]
 */
const fs = require('fs');

const [file, ...rest] = process.argv.slice(2);
const layoutOnly = rest.includes('--layout');
const max = Number((rest.find((a) => a.startsWith('--max=')) || '--max=80').slice(6));
const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const out = [];
const walk = (text, media) => {
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const head = text.slice(i, open).trim().replace(/\s+/g, ' ');
    let depth = 1;
    let j = open + 1;
    while (depth && j < text.length) {
      if (text[j] === '{') depth += 1;
      else if (text[j] === '}') depth -= 1;
      j += 1;
    }
    const body = text.slice(open + 1, j - 1);
    if (head.startsWith('@media') || head.startsWith('@supports')) walk(body, head);
    else if (!head.startsWith('@')) {
      const flat = body.replace(/\s+/g, ' ').trim();
      if (!layoutOnly || /(width|height|padding|margin|grid|flex|display|position|font-size|gap|white-space|background|overflow)/.test(flat)) {
        out.push(`${media ? `[${media}] ` : ''}${head} { ${flat.slice(0, 160)} }`);
      }
    }
    i = j;
  }
};
walk(css, '');
console.log(`${out.length} rules`);
console.log(out.slice(0, max).join('\n'));
