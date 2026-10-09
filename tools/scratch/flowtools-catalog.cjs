// Inspect the decoded tRARke (applet list) response: field positions across entries.
//   node tools/scratch/flowtools-catalog.cjs <decoded.json>
const fs = require('fs');

const { data } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const list = data[0];
console.log(`entries ${list.length}; top-level parts ${data.length}`);
const owned = list.filter((e) => !String(e[0]).startsWith('community-'));
console.log(`owned ${owned.length}, community ${list.length - owned.length}`);
const width = Math.max(...list.map((e) => e.length));
for (let i = 0; i < width; i += 1) {
  const vals = list.map((e) => e[i]).filter((v) => v !== null && v !== undefined);
  const sample = [...new Set(vals.map((v) => JSON.stringify(v)))].slice(0, 4).map((v) => v.slice(0, 120));
  console.log(`[${i}] ${vals.length}/${list.length}  ${sample.join('  |  ')}`);
}
console.log('\nowned entries:');
for (const e of owned) console.log(`  ${e[0]} ${JSON.stringify(e[2])} kind=${e[1]} state=${e[12]}`);
console.log('\nrest of response:', JSON.stringify(data.slice(1)).slice(0, 600));
