// Read-only: elements in the #willow-probe Flow tab whose own text matches, with their ancestry.
//   node tools/scratch/flow-find-text.cjs "<regex>"
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

(async () => {
  const s = await session({ tab: (u) => u.includes('#willow-probe') && u.includes('flow.google.com'), out: 'tools/ui-research/captures/flow/media/batch', front: false });
  const hits = await s.eval((src) => {
    const re = new RegExp(src);
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      if (!own || !re.test(own)) continue;
      const r = el.getBoundingClientRect();
      const chain = [];
      for (let p = el; p && chain.length < 7; p = p.parentElement) chain.push(`${p.tagName.toLowerCase()}${p.getAttribute('role') ? `[role=${p.getAttribute('role')}]` : ''}${p.className && typeof p.className === 'string' ? `.${p.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`);
      out.push({ text: own.slice(0, 40), rect: [r.x, r.y, r.width, r.height].map(Math.round), chain: chain.join(' < ') });
    }
    return out.slice(0, 20);
  }, process.argv[2]);
  for (const h of hits) console.log(JSON.stringify(h));
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
