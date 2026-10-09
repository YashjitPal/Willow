// Read-only: Flow's page geometry in the #willow-probe tab — sidebar, page and content containers,
// their paddings and the scrollbar gutter.
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

(async () => {
  const s = await session({ tab: (u) => u.includes('#willow-probe') && u.includes('flow.google.com'), out: 'tools/ui-research/captures/flow/media/batch', front: false });
  console.log(JSON.stringify(await s.eval(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { rect: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10), padding: cs.padding, client: el.clientWidth, scrollbarGutter: cs.scrollbarGutter, overflowY: cs.overflowY };
    };
    return {
      inner: innerWidth,
      sidenav: box('mat-sidenav, .mat-sidenav, mat-drawer'),
      sidenavContent: box('mat-sidenav-content, .mat-sidenav-content'),
      page: box('.page-container'),
      content: box('.content-container'),
      tiles: box('.tiles-container'),
      firstBatch: box('.batch-container'),
      pagePaddingVar: getComputedStyle(document.querySelector('.content-container') || document.body).getPropertyValue('--page-padding'),
    };
  }), null, 1));
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
