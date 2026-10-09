// One-off: a timestamped trace of menu panels being added, removed or re-classed, and of the
// submenu rows' aria-expanded, while the pointer travels to a submenu row of the tile menu.
//   node tools/scratch/w-submenu-trace.cjs "Set cover image"
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

const ROW = process.argv[2] || 'Set cover image';

(async () => {
  const s = await session({ tab: 'willow-test' });
  const pt = await s.eval(() => {
    const t = document.querySelector('main .gallery-tile[data-id="1790919091414-edit-bnz6nf"]');
    const r = t.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 3 };
  });
  await s.clickAt(pt.x, pt.y, { button: 'right' });
  await s.sleep(600);
  await s.eval(() => {
    window.__trace = [];
    const t0 = performance.now();
    const log = (m) => window.__trace.push(`${Math.round(performance.now() - t0)} ${m}`);
    const label = (el) => (el.textContent || '').trim().slice(0, 18);
    window.__obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'childList') {
          for (const n of m.addedNodes) if (n.nodeType === 1 && (n.matches('[data-sb-menu]') || n.querySelector?.('[data-sb-menu]'))) log(`+panel ${label(n)}`);
          for (const n of m.removedNodes) if (n.nodeType === 1 && (n.matches('[data-sb-menu]') || n.querySelector?.('[data-sb-menu]'))) log(`-panel ${label(n)}`);
        } else if (m.attributeName === 'class' && m.target.matches('[data-sb-menu]')) {
          log(`class ${m.target.className} ${label(m.target)}`);
        } else if (m.attributeName === 'aria-expanded') {
          log(`expanded ${m.target.getAttribute('aria-expanded')} ${label(m.target)}`);
        }
      }
    });
    window.__obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-expanded'] });
    document.addEventListener('mouseover', (e) => {
      const row = e.target.closest?.('[role="menuitem"]');
      if (row && row !== window.__lastRow) { window.__lastRow = row; log(`over ${label(row)}`); }
    }, true);
  });
  await s.hover('[data-sb-menu] [role="menuitem"]', new RegExp(`${ROW}$`));
  await s.sleep(1200);
  console.log((await s.eval(() => { window.__obs.disconnect(); return window.__trace; })).join('\n'));
  await s.key('Escape');
  await s.sleep(200);
  await s.key('Escape');
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
