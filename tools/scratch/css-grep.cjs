/**
 * Prints every rule (and keyframes block) in a captured stylesheet dump whose selector or name
 * matches a pattern, brace-balanced, each with the @media it sits in.
 *
 *   node tools/scratch/css-grep.cjs <stylesheets.css> "<regex>" [--max=200]
 */
const fs = require('fs');

const [file, pattern] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const max = Number((process.argv.find((a) => a.startsWith('--max=')) || '--max=200').slice(6));
const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const re = new RegExp(pattern);
const out = [];
const seen = new Set();
// A tiny brace-matching walker: collects top-level and nested rule blocks with their context.
const walk = (text, context) => {
  let i = 0;
  while (i < text.length && out.length < max) {
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const prelude = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    for (; j < text.length && depth > 0; j += 1) {
      if (text[j] === '{') depth += 1;
      else if (text[j] === '}') depth -= 1;
    }
    const body = text.slice(open + 1, j - 1);
    if (/^@(media|supports|layer|container)/.test(prelude)) {
      walk(body, context ? `${context} & ${prelude}` : prelude);
    } else if (re.test(prelude)) {
      const rule = `${context ? `[${context}] ` : ''}${prelude.replace(/\s+/g, ' ')} { ${body.replace(/\s+/g, ' ').trim()} }`;
      if (!seen.has(rule)) { seen.add(rule); out.push(rule); }
    }
    i = j;
  }
};
walk(css, '');
for (const rule of out) console.log(rule.length > 1600 ? `${rule.slice(0, 1600)} …` : rule);
console.log(`${out.length} rules`);
