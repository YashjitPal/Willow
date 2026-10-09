// Find an Angular component definition in a Flow bundle by selector and print its compiled
// template region, either raw (re-wrapped) or as the ordered string literals it contains.
//   node tools/scratch/ng-component.cjs <selector> [--raw] [--len=<chars>] [--before=<chars>] [--bundle=<file>]
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const sel = args.find((a) => !a.startsWith('--'));
const raw = args.includes('--raw');
const len = Number(args.find((a) => a.startsWith('--len='))?.slice(6) || 30000);
const before = Number(args.find((a) => a.startsWith('--before='))?.slice(9) || 1500);
const dir = path.join(__dirname, '../ui-research/captures/flow/tools/bundles');
const bundleArg = args.find((a) => a.startsWith('--bundle='))?.slice(9);
const files = bundleArg ? [bundleArg] : fs.readdirSync(dir).filter((f) => f.endsWith('.js'));

for (const f of files) {
  const src = fs.readFileSync(path.isAbsolute(f) ? f : path.join(dir, f), 'utf8');
  const needle = `:[["${sel}"`;
  let at = src.indexOf(needle);
  while (at >= 0) {
    const nextMatch = /\b\w{1,3}:\[\["[a-z][\w-]*"/.exec(src.slice(at + needle.length));
    const next = nextMatch ? at + needle.length + nextMatch.index : -1;
    const end = Math.min(src.length, at + len, next > 0 ? next + 200 : src.length);
    const region = src.slice(Math.max(0, at - before), end);
    console.log(`\n#### ${f} @${at} (${end - at} chars)`);
    const outFile = args.find((a) => a.startsWith('--out='))?.slice(6);
    if (outFile) {
      fs.writeFileSync(outFile, region.replace(/([;{}])(?=[a-zA-Z_$])/g, '$1\n'));
      console.log(`raw -> ${outFile}`);
    } else if (raw) {
      console.log(region.replace(/([;{}])(?=[a-zA-Z_$])/g, '$1\n'));
    } else {
      const strs = [...region.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1] ?? m[2]).filter((s) => s && !/^[\d.]+$/.test(s));
      console.log(strs.join(' · '));
    }
    at = src.indexOf(needle, at + needle.length);
  }
}
