// Prints the code following each `<name>=` / `function <name>(` definition in an extracted component,
// or across every captured bundle with --bundles.
//   node tools/scratch/ng-find.cjs <selector|--bundles> <name...> [--len=900]
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const len = Number((args.find((a) => a.startsWith('--len=')) || '--len=900').slice(6));
const bundles = args.includes('--bundles');
const rest = args.filter((a) => !a.startsWith('--'));
const sources = [];
if (bundles) {
  const dir = path.join(__dirname, '../ui-research/captures/flow/tools/bundles');
  for (const f of fs.readdirSync(dir)) sources.push([f, fs.readFileSync(path.join(dir, f), 'utf8')]);
} else {
  const sel = rest.shift();
  sources.push([sel, fs.readFileSync(path.join(__dirname, '../ui-research/captures/flow/tools/ng', `${sel}.js`), 'utf8')]);
}
for (const name of rest) {
  const esc = name.replace(/[$]/g, '\\$');
  const re = new RegExp(`(?:function ${esc}\\(|[,;\\s]${esc}=)`, 'g');
  let found = false;
  for (const [file, src] of sources) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      found = true;
      console.log(`==== ${name} in ${file} @${m.index}`);
      console.log(src.slice(m.index, m.index + len));
    }
  }
  if (!found) console.log(`==== ${name}: not found`);
}
