// One-off: opens a collection's trash dialog on :3101 and reports, once a second, whether it is
// still open (it closed on its own once). Cancels at the end.
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

(async () => {
  const s = await session({ tab: 'willow-test', out: 'tools/ui-research/captures/flow/media/willow/collections' });
  const r = await s.eval(() => {
    const t = document.querySelector('[data-drop-collection]');
    if (!t) return null;
    const b = t.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  if (!r) { console.log('no collection tile'); await s.close(); return; }
  await s.clickAt(r.x, r.y, { button: 'right' });
  await s.sleep(500);
  await s.click('[role="menuitem"]', /Move all contents to trash/);
  for (let i = 0; i < 6; i += 1) {
    await s.sleep(1000);
    console.log(`${i + 1}s open:`, await s.eval(() => !!document.querySelector('[role="dialog"]')), 'focused:', await s.eval(() => document.activeElement?.textContent?.trim().slice(0, 20)));
  }
  if (await s.eval(() => !!document.querySelector('[role="dialog"]'))) {
    await s.click('[role="dialog"] button', /^Cancel$/);
    await s.sleep(500);
  }
  console.log('final open:', await s.eval(() => !!document.querySelector('[role="dialog"]')));
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
