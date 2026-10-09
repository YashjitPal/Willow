// Grep the ported tool sources (features/media/src/tools/catalog/sources/*.json) as code:
// prints each match with surrounding lines, per tool file.
//   node tools/scratch/flowtools-grep.cjs "<regex>" [contextLines=4] [maxMatches=20]
const fs = require('fs');
const path = require('path');

const [pattern, ctxArg = '4', maxArg = '20'] = process.argv.slice(2);
const re = new RegExp(pattern);
const ctx = Number(ctxArg);
let left = Number(maxArg);
const dir = path.join(__dirname, '../../features/media/src/tools/catalog/sources');
const catalog = JSON.parse(fs.readFileSync(path.join(dir, '../catalog.json'), 'utf8'));
const names = Object.fromEntries([...catalog.templates, ...catalog.community].map((t) => [t.id, t.name]));

for (const f of fs.readdirSync(dir)) {
  const id = f.replace(/\.json$/, '');
  const { files } = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const file of files) {
    const lines = file.content.split('\n');
    lines.forEach((line, i) => {
      if (left <= 0 || !re.test(line)) return;
      left -= 1;
      console.log(`\n--- ${names[id] ?? id} :: ${file.path}:${i + 1}`);
      console.log(lines.slice(Math.max(0, i - ctx), i + ctx + 1).join('\n'));
    });
  }
}
