// Prints the rules of willow-tv.css that mention the given modules, with their @media wrapper.
//   node tools/scratch/wtv-css-rules.cjs header video tv-remote
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../../features/media/src/tv/willow-tv.css'), 'utf8');
const mods = process.argv.slice(2);
const lines = css.split(/\r?\n/);
let media = null;
for (const line of lines) {
  if (/^@media/.test(line)) { media = line.replace(/\s*\{\s*$/, ''); continue; }
  if (/^\}/.test(line)) { media = null; continue; }
  if (!mods.some((m) => line.includes(`.wtv-${m}__`))) continue;
  console.log(media ? `[${media.replace('only screen and ', '')}] ${line.trim()}` : line.trim());
}
