/**
 * Every hit of a regex in one cached Gemini bundle (by file name prefix), each with context, optionally limited to
 * a window around an offset.
 *
 *   node tools/scratch/bundle-grep.cjs <file prefix> <regex> [context=200] [center] [radius]
 */
const fs = require('fs');
const path = require('path');

const [prefix, pattern, context = '200', center, radius] = process.argv.slice(2);
const dir = path.join(__dirname, '..', 'ui-research', 'captures', 'gemini', 'bundles');
const name = fs.readdirSync(dir).find((n) => n.startsWith(prefix));
if (!name) throw new Error(`no bundle ${prefix}`);
const text = fs.readFileSync(path.join(dir, name), 'utf8');
const re = new RegExp(pattern, 'g');
const lo = center ? Number(center) - Number(radius) : 0;
const hi = center ? Number(center) + Number(radius) : text.length;
re.lastIndex = Math.max(0, lo);
let m;
while ((m = re.exec(text)) && m.index < hi) {
  const c = Number(context);
  console.log(`== @${m.index} ${m[0]}\n${text.slice(Math.max(0, m.index - c), m.index + m[0].length + c)}\n`);
  if (m[0].length === 0) re.lastIndex += 1;
}
