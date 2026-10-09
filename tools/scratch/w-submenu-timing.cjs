// One-off: opens the sbtest1 collection, right-clicks its generated item, hovers a submenu row and
// samples the submenu panel's rect, transform and running animations for 1.5s.
//   node tools/scratch/w-submenu-timing.cjs "Set cover image"|"Download"
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

const ROW = process.argv[2] || 'Set cover image';

(async () => {
  const s = await session({ tab: 'willow-test' });
  if (!(await s.eval(() => location.search.includes('collection=')))) {
    await s.page.goto('http://localhost:3101/media?projectId=sbtest1', { waitUntil: 'networkidle2' }).catch(() => {});
    await s.sleep(3500);
    await s.click('[data-drop-collection] .ct-preview');
    await s.sleep(1500);
  }
  console.log('visibility', await s.eval(() => document.visibilityState));
  const pt = await s.eval(() => {
    const t = document.querySelector('main .gallery-tile[data-id="1790919091414-edit-bnz6nf"]');
    const r = t.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 3 };
  });
  await s.clickAt(pt.x, pt.y, { button: 'right' });
  await s.sleep(600);
  await s.hover('[data-sb-menu] [role="menuitem"]', new RegExp(`${ROW}$`));
  const t0 = Date.now();
  for (let i = 0; i < 12; i += 1) {
    const st = await s.eval(() => {
      const ps = [...document.querySelectorAll('[data-sb-menu]')];
      const sub = ps.length > 1 ? ps[ps.length - 1] : null;
      if (!sub) return { panels: ps.length };
      const r = sub.getBoundingClientRect();
      return {
        panels: ps.length,
        rect: [r.width, r.height].map((v) => Math.round(v * 10) / 10),
        transform: getComputedStyle(sub).transform,
        anims: sub.getAnimations({ subtree: true }).map((a) => `${a.animationName || a.id}:${a.playState}@${Math.round(a.currentTime)}`),
        cls: sub.className,
      };
    });
    console.log(Date.now() - t0, JSON.stringify(st));
    await s.sleep(120);
  }
  await s.key('Escape');
  await s.sleep(200);
  await s.key('Escape');
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
