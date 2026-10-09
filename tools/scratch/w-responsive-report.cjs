// Prints what w-responsive.cjs recorded: console errors, off-screen controls and small targets.
// Usage: node tools/scratch/w-responsive-report.cjs [metrics file name] [--surface=a,b] [--detail]
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'ui-research', 'captures', 'willow', 'responsive');
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) || 'metrics-phone-tablet.json';
const only = (args.find((a) => a.startsWith('--surface=')) || '').slice(10).split(',').filter(Boolean);
const detail = args.includes('--detail');
const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
const rows = Array.isArray(data) ? data : Object.values(data).flat();
for (const row of rows) {
  if (only.length && !only.includes(row.surface)) continue;
  const errors = row.errors || [];
  const off = row.offscreen || row.off || [];
  const small = row.small || [];
  if (!detail && !errors.length) continue;
  console.log(`== ${row.size} ${row.surface}`);
  for (const e of errors.slice(0, 4)) console.log('   error:', String(e.text || e.message || e).slice(0, 400));
  if (detail) {
    for (const o of (Array.isArray(off) ? off : []).slice(0, 12)) console.log('   off:', JSON.stringify(o).slice(0, 200));
    for (const s of (Array.isArray(small) ? small : []).slice(0, 30)) console.log('   small:', JSON.stringify(s).slice(0, 200));
  }
}
