// Prints the Luminous Symbols / Google Symbols kit URLs in apps/studio/index.html, committed vs working tree.
//   node tools/scratch/icon-kit-urls.cjs [--restore]   --restore puts the committed URLs back
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../..');
const FILE = path.join(REPO, 'apps/studio/index.html');
const committed = execSync('git show HEAD:apps/studio/index.html', { cwd: REPO, encoding: 'utf8', maxBuffer: 32 << 20 });
const working = fs.readFileSync(FILE, 'utf8');
const urlOf = (html, family) => {
  const m = html.match(new RegExp(`font-family:\\s*"${family}";[\\s\\S]{0,1200}?src:\\s*url\\("([^"]+)"\\)`));
  return m ? m[1] : null;
};
let next = working;
for (const family of ['Luminous Symbols', 'Google Symbols']) {
  const before = urlOf(committed, family);
  const now = urlOf(working, family);
  console.log(`${family}: ${before === now ? 'same as HEAD' : 'CHANGED from HEAD'}`);
  console.log(`  HEAD:    ${before}`);
  console.log(`  working: ${now}`);
  if (process.argv.includes('--restore') && before && now && before !== now) next = next.replace(now, before);
}
console.log(execSync('git log -3 --format="%h %ad %an %s" --date=iso -- apps/studio/index.html', { cwd: REPO, encoding: 'utf8' }));
if (process.argv.includes('--restore') && next !== working) {
  fs.writeFileSync(FILE, next);
  console.log('restored the committed URLs');
}
