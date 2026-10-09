// Summarizes a `node --test` run saved to a file (any encoding PowerShell wrote it in): the
// totals and the names of failing tests, top-level only.
//   node tools/scratch/test-summary.cjs tools/scratch/out-tests.txt
const fs = require('fs');

const raw = fs.readFileSync(process.argv[2]);
const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8').replace(/^\uFEFF/, '');
const lines = text.split(/\r?\n/);
for (const l of lines) if (/^\S+ (tests|pass|fail|cancelled) \d+$/.test(l.trim())) console.log(l.trim());
const failed = [...new Set(lines.filter((l) => /^\u2716 /.test(l)).map((l) => l.replace(/\s*\(\d+(\.\d+)?ms\)$/, '')))];
console.log(`failing (${failed.length}):`);
for (const f of failed) console.log(`  ${f}`);
