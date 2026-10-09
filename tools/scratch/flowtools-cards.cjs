// List the sections and cards of a Flow Tools dump: section title, then per card the name,
// author, description, icon and preview image.
//   node tools/scratch/flowtools-cards.cjs <dump-name> [--json=<out>]
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dumpName = args.find((a) => !a.startsWith('--'));
const jsonOut = args.find((a) => a.startsWith('--json='))?.slice(7);
const file = path.join(__dirname, '../ui-research/captures/flow/tools/dump', `${dumpName}.json`);
const { nodes } = JSON.parse(fs.readFileSync(file, 'utf8'));
const byId = new Map(nodes.map((n) => [n.id, { ...n, kids: [] }]));
for (const n of byId.values()) byId.get(n.p)?.kids.push(n);
const has = (n, c) => (n.cls || '').split(/\s+/).includes(c);
const all = (n, pred, out = []) => { for (const k of n.kids) { if (pred(k)) out.push(k); all(k, pred, out); } return out; };
const first = (n, pred) => all(n, pred)[0];
const textOf = (n) => [n.text || '', ...n.kids.map(textOf)].join(' ').replace(/\s+/g, ' ').trim();
const srcOf = (n) => n && (n.attrs?.src || n.src);

const sections = [...byId.values()].filter((n) => n.tag === 'section' || n.tag === 'flow-applet-hero-banner' || n.tag === 'flow-applet-carousel');
const result = [];
for (const sec of sections) {
  const title = first(sec, (n) => n.tag === 'h2' || has(n, 'section-title'));
  const cards = all(sec, (n) => n.tag === 'flow-applet-card' || has(n, 'create-applet-card') || has(n, 'spotlight-card'));
  const entry = { tag: sec.tag, cls: sec.cls, rect: sec.rect, title: title ? textOf(title) : null, cards: [] };
  for (const c of cards) {
    const pick = (cls) => { const e = first(c, (n) => has(n, cls)); return e ? textOf(e) : null; };
    const icon = first(c, (n) => n.tag === 'img' && /icon|thumbnail/.test(n.cls || ''));
    const preview = first(c, (n) => n.tag === 'img' && /preview/.test(n.cls || ''));
    const video = first(c, (n) => n.tag === 'video');
    entry.cards.push({
      cls: first(c, () => true)?.cls,
      rect: c.rect?.map(Math.round),
      name: pick('applet-name') || pick('create-applet-name'),
      author: pick('applet-author'),
      description: pick('applet-description'),
      icon: srcOf(icon),
      preview: srcOf(preview) || srcOf(video),
    });
  }
  result.push(entry);
  console.log(`\n## ${sec.tag}.${sec.cls || ''} ${JSON.stringify(sec.rect?.map(Math.round))} ${entry.title ? `"${entry.title}"` : `${textOf(sec).slice(0, 160)}`}`);
  for (const c of entry.cards) console.log(`  - ${c.name} | ${c.author} | ${c.description} | icon=${(c.icon || '').replace('https://www.gstatic.com/aitestkitchen/website/flow/applets/', '…/')} | preview=${(c.preview || '').replace('https://www.gstatic.com/aitestkitchen/website/flow/applets/', '…/').slice(0, 90)} | ${JSON.stringify(c.rect)}`);
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(result, null, 1));
