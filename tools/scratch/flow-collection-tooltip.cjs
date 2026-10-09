// One-off: does hovering a Flow collection tile's More button show a tooltip, and after how long?
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

(async () => {
  const s = await session({ tab: 'flow', out: 'tools/ui-research/captures/flow/media/collections' });
  const t = await s.eval(() => {
    const el = document.querySelector('flow-collection-tile');
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await s.sleep(600);
  await s.moveTo(t.x, t.y, 6);
  await s.sleep(800);
  const b = await s.eval(() => {
    const btn = document.querySelector('flow-collection-tile button[aria-label="More options"]');
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, attrs: [...btn.attributes].map((a) => `${a.name}=${a.value.slice(0, 30)}`).join(' ') };
  });
  console.log(b.attrs);
  await s.moveTo(b.x, b.y, 4);
  const t0 = Date.now();
  let seen = null;
  while (Date.now() - t0 < 3000) {
    seen = await s.eval(() => document.querySelector('.mat-mdc-tooltip-surface')?.textContent.trim() ?? null);
    if (seen) break;
    await s.sleep(100);
  }
  console.log('tooltip', JSON.stringify(seen), 'after', Date.now() - t0, 'ms');
  await s.moveTo(1530, 820, 3);
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
