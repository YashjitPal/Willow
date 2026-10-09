// Prints [from, to) of a captured Flow bundle, with `;` and `{` line breaks for reading.
//   node tools/scratch/bundle-slice.cjs <bundle file> <from> <to> [--raw]
const fs = require('fs');
const path = require('path');

const [file, from, to] = process.argv.slice(2);
const src = fs.readFileSync(path.join(__dirname, '../ui-research/captures/flow/tools/bundles', file), 'utf8');
const text = src.slice(Number(from), Number(to));
console.log(process.argv.includes('--raw') ? text : text.replace(/;(?=\S)/g, ';\n').replace(/\{(?=\S)/g, '{\n'));
