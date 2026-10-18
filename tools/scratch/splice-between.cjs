/**
 * Replaces everything from <start> (inclusive) up to <end> (exclusive) in <file> with <content file>, keeping
 * the file's line endings (CRLF if the file has any).
 *
 *   node tools/scratch/splice-between.cjs <file> <start marker> <end marker> <content file>
 */
const fs = require('fs');

const [file, start, end, contentFile] = process.argv.slice(2);
const text = fs.readFileSync(file, 'utf8');
const crlf = text.includes('\r\n');
const from = text.indexOf(start);
const to = text.indexOf(end, from + start.length);
if (from === -1 || to === -1) throw new Error(`markers not found: ${from} ${to}`);
let content = fs.readFileSync(contentFile, 'utf8').replace(/\r\n/g, '\n');
if (crlf) content = content.replace(/\n/g, '\r\n');
fs.writeFileSync(file, text.slice(0, from) + content + text.slice(to));
console.log(`replaced ${to - from} chars with ${content.length} (${crlf ? 'crlf' : 'lf'})`);
