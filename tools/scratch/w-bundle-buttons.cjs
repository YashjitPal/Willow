// The buttons of Flow's components as compiled: each matButton's appearance (its attribute value)
// and the variant/disabled bindings in template order, read from the component's definition.
//   node tools/scratch/w-bundle-buttons.cjs <selector> [<selector> ...]
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../ui-research/captures/flow/bundles');
const bundles = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
for (const selector of process.argv.slice(2)) {
  const text = bundles.find((t) => t.includes(`Da:[["${selector}"]]`));
  if (!text) { console.log(`== ${selector}: not in the captured bundles`); continue; }
  const at = text.indexOf(`Da:[["${selector}"]]`);
  const end = text.indexOf('dependencies:', at);
  const def = text.slice(at, end > at ? end : at + 12000);
  const buttons = [...def.matchAll(/\["(matButton|matIconButton|mat-flat-button|mat-button|mat-stroked-button)","([^"]*)"[^\]]*\]/g)].map((m) => `${m[1]}="${m[2]}"`);
  const bindings = [...def.matchAll(/\("(variant|disabled|appearance)",([^)]{1,60})\)/g)].map((m) => `${m[1]}=${m[2]}`);
  const labels = [...def.matchAll(/_\.Ok\(" ",b\.(\w+)," "\)/g)].map((m) => m[1]);
  console.log(`== ${selector}\n   buttons: ${buttons.join(' | ')}\n   bindings: ${bindings.join(' | ')}\n   labels (fields): ${labels.join(', ')}`);
}
