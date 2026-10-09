// Prints short snippets around matches in cached bundle files, for minified one-line chunks where
// a grep returns whole megabyte lines. Patterns come from a JSON file (an array of regex sources),
// so no shell has to quote them.
//   node tools/scratch/bundle-ctx.cjs <dir-or-file> <patterns.json> [contextChars=300] [maxPerFile=4]
const fs = require('fs');
const path = require('path');

const [target, patternsFile, ctxArg, maxArg] = process.argv.slice(2);
const CTX = Number(ctxArg || 300);
const MAX = Number(maxArg || 4);
const patterns = JSON.parse(fs.readFileSync(patternsFile, 'utf8')).map((p) => new RegExp(p, 'g'));
const files = fs.statSync(target).isDirectory() ? fs.readdirSync(target).map((f) => path.join(target, f)) : [target];

for (const re of patterns) {
  console.log(`\n##### /${re.source}/`);
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    if (src.length > 400000) continue; // vendor blobs (an extension's scriptlets), not the app
    let n = 0;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) && n < MAX) {
      n += 1;
      const from = Math.max(0, m.index - CTX);
      console.log(`--- ${path.basename(file).slice(0, 12)} @${m.index}\n${src.slice(from, m.index + m[0].length + CTX).replace(/\s+/g, ' ')}`);
    }
  }
}
