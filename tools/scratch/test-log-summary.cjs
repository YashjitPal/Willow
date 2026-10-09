// Summarises a `node --test` log: the totals and the name of every failing test with its file.
// Usage: node tools/scratch/test-log-summary.cjs <log file>
const fs = require('fs');

const raw = fs.readFileSync(process.argv[2]);
// PowerShell's redirection writes UTF-16 LE; a log written by node itself is UTF-8.
const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8');
const lines = text.split(/\r?\n/);
for (const line of lines) if (/^ℹ (tests|pass|fail|cancelled|skipped|todo) /.test(line)) console.log(line);
console.log('---- failing ----');
let file = '';
for (const line of lines) {
  const at = line.match(/^test at (.+?):\d+:\d+$/);
  if (at) { file = at[1]; continue; }
  const failed = line.match(/^\s*✖ (.+?) \(\d/);
  if (failed && file) console.log(`${file} :: ${failed[1]}`);
}
