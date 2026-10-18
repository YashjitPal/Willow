// Line endings of the given files: CRLF and lone-LF counts, and a BOM. `--lf <file>` / `--crlf <file>` rewrites one.
const fs = require('fs');

const args = process.argv.slice(2);
const mode = args[0] === '--lf' || args[0] === '--crlf' ? args.shift() : null;
for (const file of args) {
  let text = fs.readFileSync(file, 'utf8');
  if (mode) {
    text = text.replace(/\r\n/g, '\n');
    if (mode === '--crlf') text = text.replace(/\n/g, '\r\n');
    fs.writeFileSync(file, text);
  }
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  console.log(`${file}  crlf ${crlf}  lone-lf ${lf}${text.charCodeAt(0) === 0xfeff ? '  BOM' : ''}`);
}
