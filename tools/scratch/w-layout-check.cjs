// One-off: are the :3101 gallery's rows intact? Lists inline-styled tiles, then (with --reload)
// reloads and reports each visual row's tile heights, which must be equal within a row.
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

const rows = (s) => s.eval(() => {
  const tiles = [...document.querySelectorAll('main .gallery-tile')].map((t) => {
    const r = t.getBoundingClientRect();
    return { top: Math.round(r.top), h: Math.round(r.height * 10) / 10, w: Math.round(r.width) };
  });
  const byTop = new Map();
  for (const t of tiles) byTop.set(t.top, [...(byTop.get(t.top) || []), t]);
  return [...byTop].slice(0, 6).map(([top, ts]) => `top ${top}: heights ${ts.map((t) => t.h).join(', ')} widths ${ts.map((t) => t.w).join(', ')}`);
});

(async () => {
  const s = await session({ tab: 'willow-test', out: 'tools/scratch' });
  console.log('inline-sized tiles:', JSON.stringify(await s.eval(() => [...document.querySelectorAll('[data-drop-collection]')].map((t) => t.getAttribute('style')))));
  console.log((await rows(s)).join('\n'));
  if (process.argv.includes('--reload')) {
    await s.page.reload({ waitUntil: 'networkidle2' }).catch(() => {});
    await s.sleep(3500);
    console.log('--- after reload');
    console.log((await rows(s)).join('\n'));
    await s.shot('layout-after-reload');
  }
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
