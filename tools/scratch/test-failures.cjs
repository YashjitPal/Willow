// Lists the failing test names in a saved `npm test` log (UTF-8 or the UTF-16 PowerShell writes).
//   node tools/scratch/test-failures.cjs <log>
const fs = require('fs');

const raw = fs.readFileSync(process.argv[2]);
const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8');
// A PowerShell redirect decodes node's UTF-8 through code page 437: ✖ arrives as Γ£û, ℹ as Γä╣.
const CROSS = '(?:✖|Γ£û)';
const INFO = '(?:ℹ|Γä╣)';
const lines = text.split(/\r?\n/);
const summary = lines.filter((l) => new RegExp(`^\\s*${INFO} (tests|pass|fail|cancelled) `).test(l)).map((l) => l.trim().replace(new RegExp(`^${INFO}`), 'i'));
const failing = [...new Set(lines
  .filter((l) => new RegExp(`^\\s*${CROSS} `).test(l) && !/failing tests/.test(l))
  .map((l) => l.trim().replace(new RegExp(`^${CROSS} `), '').replace(/\s*\([\d.]+m?s\)$/, '')))];
console.log(summary.join('\n'));
console.log(`--- ${failing.length} failing ---`);
for (const name of failing) console.log(name);
