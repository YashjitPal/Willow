// One-off: the tooltip text and box of each Flow header button.
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

(async () => {
  const s = await session({ tab: 'flow', out: 'tools/ui-research/captures/flow/media/collections' });
  for (const label of process.argv.includes('--right-more') ? ['More options'] : ['Add media menu', 'Product help', 'Tile grid settings', 'More options for the project', 'Back button', 'Search', 'Filter']) {
    const hit = await s.eval((l) => {
      const b = [...document.querySelectorAll('header button, flow-navigation-header button, button')].find((x) => (x.getAttribute('aria-label') || '') === l && x.getBoundingClientRect().top < 70 && x.getBoundingClientRect().left > 1000)
        || [...document.querySelectorAll('header button, flow-navigation-header button, button')].find((x) => (x.getAttribute('aria-label') || '').startsWith(l) && x.getBoundingClientRect().top < 70);
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, rect: [r.x, r.y, r.width, r.height] };
    }, label);
    if (!hit) { console.log(label, 'not found'); continue; }
    await s.moveTo(hit.x, hit.y, 4);
    let tip = null;
    for (let i = 0; i < 20 && !tip; i += 1) {
      await s.sleep(100);
      tip = await s.eval(() => { const el = document.querySelector('.mat-mdc-tooltip-surface'); if (!el) return null; const r = el.getBoundingClientRect(); return { text: el.textContent.trim(), rect: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10) }; });
    }
    console.log(label, JSON.stringify(hit.rect.map((v) => Math.round(v * 10) / 10)), '->', JSON.stringify(tip));
    await s.moveTo(900, 400, 3);
    await s.sleep(400);
  }
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
