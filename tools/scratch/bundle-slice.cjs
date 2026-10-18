/**
 * Prints characters <from> to <to> of one cached Gemini bundle (by file name prefix).
 *
 *   node tools/scratch/bundle-slice.cjs <file prefix> <from> <to>
 */
const fs = require('fs');
const path = require('path');

const [prefix, from, to] = process.argv.slice(2);
const dir = path.join(__dirname, '..', 'ui-research', 'captures', 'gemini', 'bundles');
const name = fs.readdirSync(dir).find((n) => n.startsWith(prefix));
if (!name) throw new Error(`no bundle ${prefix}`);
process.stdout.write(fs.readFileSync(path.join(dir, name), 'utf8').slice(Number(from), Number(to)));
