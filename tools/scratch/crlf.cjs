// The repo's files end lines with CRLF and carry no byte-order mark; this makes the given files so.
//   node tools/scratch/crlf.cjs <file> [<file> ...]
const fs = require('fs');

for (const file of process.argv.slice(2)) {
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(/^\uFEFF/, '').replace(/\r?\n/g, '\r\n');
  if (after !== before) fs.writeFileSync(file, after);
  console.log(`${after !== before ? 'fixed ' : 'ok    '} ${file}`);
}
