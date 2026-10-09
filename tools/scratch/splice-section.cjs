// Replaces the text from a start marker through the line holding an end marker with a file's text.
//   node tools/scratch/splice-section.cjs <target> <replacement-file> <start-marker> <end-marker>
const fs = require('fs');

const [target, replacementFile, startMarker, endMarker] = process.argv.slice(2);
const src = fs.readFileSync(target, 'utf8');
const start = src.indexOf(startMarker);
if (start < 0) throw new Error('start marker not found');
const endAt = src.indexOf(endMarker, start);
if (endAt < 0) throw new Error('end marker not found');
const lineEnd = src.indexOf('\n', endAt);
const end = lineEnd < 0 ? src.length : lineEnd + 1;
const eol = src.includes('\r\n') ? '\r\n' : '\n';
const replacement = fs.readFileSync(replacementFile, 'utf8').replace(/\r?\n/g, eol);
fs.writeFileSync(target, src.slice(0, start) + replacement + src.slice(end));
console.log(`replaced ${end - start} chars with ${replacement.length}`);
