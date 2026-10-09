// Prints the rules of a stylesheet whose selector contains every given fragment.
// Usage: node tools/scratch/css-rules.cjs <css file> <fragment> [fragment ...] [--max=400]
const fs = require('fs');

const args = process.argv.slice(2);
const file = args.shift();
const max = Number((args.find((a) => a.startsWith('--max=')) || '--max=600').slice(6));
const fragments = args.filter((a) => !a.startsWith('--'));
const css = fs.readFileSync(file, 'utf8');

// Walks the sheet brace by brace so rules inside @media blocks come out with their query.
let depth = 0;
let start = 0;
const stack = [];
for (let i = 0; i < css.length; i += 1) {
  const ch = css[i];
  if (ch === '{') {
    const head = css.slice(start, i).trim();
    stack.push(head);
    depth += 1;
    start = i + 1;
  } else if (ch === '}') {
    const head = stack.pop() || '';
    const body = css.slice(start, i).trim();
    depth -= 1;
    start = i + 1;
    if (head.startsWith('@')) continue;
    if (fragments.every((f) => head.includes(f))) {
      const media = stack.filter((h) => h.startsWith('@media')).join(' ');
      console.log(`${media ? `${media} :: ` : ''}${head} { ${body.slice(0, max)}${body.length > max ? ' …' : ''} }`);
    }
  }
}
