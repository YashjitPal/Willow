// A Flow component's template constants (the attribute arrays its buttons and inputs get), found by
// its selector in the captured bundles. node tools/scratch/w-bundle-component.cjs <selector> [chars=6000]
const fs = require('fs');
const path = require('path');

const [selector, chars = '6000'] = process.argv.slice(2);
const dir = path.join(__dirname, '../ui-research/captures/flow/bundles');
for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const text = fs.readFileSync(path.join(dir, name), 'utf8');
  const at = text.indexOf(`Da:[["${selector}"]]`);
  if (at < 0) continue;
  const body = text.slice(at, at + Number(chars));
  const arrays = [...body.matchAll(/\[[^[\]]*\]/g)].map((m) => m[0]).filter((a) => /"(variant|appearance|type|disabled|class|aria-label|mat-flat-button|mat-button)"|button|Button/.test(a));
  console.log(`--- ${name.slice(0, 10)} @${at}\n${arrays.join('\n')}`);
  break;
}
