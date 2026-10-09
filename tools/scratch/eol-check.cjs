// Reports each file's line endings: CRLF, lone LF, or mixed (a CRLF file an edit gave LF lines).
// Usage: node tools/scratch/eol-check.cjs <file> [file ...]
const fs = require('fs');

for (const file of process.argv.slice(2)) {
  const text = fs.readFileSync(file, 'utf8');
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  const kind = crlf && lf ? 'MIXED' : crlf ? 'crlf' : 'lf';
  console.log(`${kind.padEnd(6)} crlf ${String(crlf).padStart(5)}  lf ${String(lf).padStart(5)}  ${file}`);
}
