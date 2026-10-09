// Replaces everything from a start marker to the end of a file with a file's text.
//   node tools/scratch/splice-to-end.cjs <target> <replacement-file> <start-marker>
const fs = require('fs');

const [target, replacementFile, startMarker] = process.argv.slice(2);
const src = fs.readFileSync(target, 'utf8');
const start = src.indexOf(startMarker);
if (start < 0) throw new Error('start marker not found');
const eol = src.includes('\r\n') ? '\r\n' : '\n';
const replacement = fs.readFileSync(replacementFile, 'utf8').replace(/\r?\n/g, eol);
fs.writeFileSync(target, src.slice(0, start) + replacement);
console.log(`replaced ${src.length - start} chars with ${replacement.length}`);
