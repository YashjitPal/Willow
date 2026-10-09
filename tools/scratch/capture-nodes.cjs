/**
 * Prints part of a `gemini-open-capture.cjs` dump: the nodes from the first one whose tag,
 * class or text matches a pattern, and the matching stretch of its HTML with Angular's
 * scoping attributes stripped.
 *
 *   node tools/scratch/capture-nodes.cjs <dump.json> "<pattern>" [count=40] [--html=4000] [--before=4]
 */
const fs = require('fs');

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const [file, pattern, countArg] = args.filter((a) => !a.startsWith('--'));
const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
const wanted = new RegExp(pattern, 'i');
const index = dump.nodes.findIndex((n) => wanted.test(`${n.tag}.${n.cls}`) || wanted.test(n.text || ''));
if (index === -1) {
  console.log('no node matches', pattern);
  process.exit(1);
}
const before = Number(flags.before ?? 4);
const count = Number(countArg ?? 40);
for (const n of dump.nodes.slice(Math.max(0, index - before), index + count)) {
  console.log(
    `${n.tag}.${n.cls}`.slice(0, 76).padEnd(76),
    JSON.stringify(n.rect).padEnd(34),
    (n.text || n.aria || '').slice(0, 34).padEnd(34),
    JSON.stringify(n.cs).slice(0, 300),
  );
}
if (flags.html && dump.html) {
  const tag = dump.nodes[index].tag;
  const at = dump.html.indexOf(`<${tag}`);
  const html = dump.html.slice(Math.max(0, at), Math.max(0, at) + Number(flags.html))
    .replace(/ _ngcontent-ng-c\d+=""/g, '')
    .replace(/ _nghost-ng-c\d+=""/g, '')
    .replace(/<!---->/g, '');
  console.log('\nHTML:\n', html);
}
