// What the captured Flow tools need from a runtime: Flow SDK calls, model display names, npm
// imports, aspect ratios, other risky globals. Reads captures/flow/tools/catalog/*.json.
//   node tools/scratch/flowtools-usage.cjs [--per-tool]
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../ui-research/captures/flow/tools/catalog');
const perTool = process.argv.includes('--per-tool');
const tally = (map, key, tool) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(tool); };
const sdk = new Map(); const models = new Map(); const pkgs = new Map(); const ratios = new Map(); const misc = new Map(); const exts = new Map();

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const name = t.name;
  for (const file of t.files) {
    tally(exts, path.extname(file.path) || file.path, name);
    const c = file.content || '';
    for (const m of c.matchAll(/\bFlow\.((?:generate|media|camera|microphone|storage)\.\w+|save|upload|download)\b/g)) tally(sdk, m[1], name);
    for (const m of c.matchAll(/modelDisplayName\s*:\s*['"`]([^'"`]+)['"`]/g)) tally(models, m[1], name);
    for (const m of c.matchAll(/['"`]((?:Nano Banana|Veo|Imagen|Gemini|Lyria)[^'"`]{0,30})['"`]/g)) tally(models, `(literal) ${m[1]}`, name);
    for (const m of c.matchAll(/aspectRatio\s*:\s*['"`]([^'"`]+)['"`]/g)) tally(ratios, m[1], name);
    for (const m of c.matchAll(/(?:import\s[^'"]*?from\s*|import\s*\(\s*|^\s*import\s+)['"]([^'"./][^'"]*)['"]/gm)) tally(pkgs, m[1].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0], name);
    for (const m of c.matchAll(/\b(process\.env\.\w+|GoogleGenAI|@google\/genai|localStorage|indexedDB|navigator\.mediaDevices|getUserMedia|new Worker|WebGL2RenderingContext|getContext\(['"]webgl2?['"]\)|AudioContext|fetch\(|window\.open|showSaveFilePicker|document\.cookie)/g)) tally(misc, m[1], name);
  }
}
const show = (title, map) => {
  console.log(`\n## ${title}`);
  for (const [k, v] of [...map.entries()].sort((a, b) => b[1].size - a[1].size)) console.log(`  ${String(v.size).padStart(3)}  ${k}${perTool ? `   <- ${[...v].join(', ')}` : ''}`);
};
show('Flow SDK calls', sdk);
show('model display names', models);
show('aspect ratios', ratios);
show('npm imports', pkgs);
show('other APIs', misc);
show('file types', exts);
