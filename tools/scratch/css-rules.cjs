/**
 * Every rule in a captured stylesheet dump whose selector matches <regex>, with its @media wrapper, one per line.
 *
 *   node tools/scratch/css-rules.cjs <dump file in captures/gemini/customize> <selector regex> [max=80]
 */
const fs = require('fs');
const path = require('path');

const [file, pattern, max = '80'] = process.argv.slice(2);
const css = fs.readFileSync(path.join(__dirname, '..', 'ui-research', 'captures', 'gemini', 'customize', file), 'utf8');
const re = new RegExp(pattern);
const out = [];
const walk = (text, wrap) => {
  let i = 0;
  while (i < text.length && out.length < Number(max)) {
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const head = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) { if (text[j] === '{') depth += 1; else if (text[j] === '}') depth -= 1; j += 1; }
    const body = text.slice(open + 1, j - 1);
    if (/^@(media|supports|container|layer)/.test(head)) walk(body, head);
    else if (re.test(head)) out.push(`${wrap ? `${wrap} ` : ''}${head.replace(/\[_ng(content|host)-ng-c\d+\]/g, '')} { ${body.trim().replace(/\s+/g, ' ')} }`);
    i = j;
  }
};
walk(css, '');
console.log(out.join('\n'));
