/**
 * Records the chat home's glow arriving in Willow (the :3000 tab that is not /media):
 *   reload  reload the chat home
 *   tabs    from the chat home, open Code in the sidebar, then New chat
 * Each phase writes a recording (animations, DOM changes, frames) and timed screenshots
 * under tools/ui-research/captures/willow/home-glow/. Nothing is typed or sent.
 *
 *   node tools/scratch/w-glow-rec.cjs reload|tabs
 */
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

const PHASES = {
  async reload(s) {
    await s.goto('http://localhost:3000/');
    await s.sleep(3000);
    const rec = await s.rec('reload');
    await rec.mark('reload');
    await s.eval(() => location.reload());
    let last = 0;
    for (const ms of [300, 600, 900, 1300, 1800, 3000]) {
      await s.sleep(ms - last);
      last = ms;
      await s.shot(`reload-${ms}`);
    }
    await rec.stop();
  },
  // The same switch with the desktop mask swapped for a bitmap, through an in-page <style> only.
  async 'tabs-bitmap'(s) {
    await s.eval(() => {
      let style = document.getElementById('glow-bitmap-test');
      if (!style) {
        style = document.createElement('style');
        style.id = 'glow-bitmap-test';
        document.head.appendChild(style);
      }
      style.textContent = `@media (min-width: 961px) {
        html body .willow-gemini-home-glow > .willow-home-glow-layer::before,
        html body .willow-gemini-home-glow > .willow-home-glow-layer::after {
          -webkit-mask-image: url("/glow-mask-test-742.webp"); mask-image: url("/glow-mask-test-742.webp");
        }
      }`;
    });
    await s.sleep(1500);
    await PHASES.tabs(s, 'tabs-bitmap');
  },
  async tabs(s, name = 'tabs') {
    await s.sleep(800);
    await s.click('.sidebar-item-row', /^Code$/);
    await s.sleep(2000);
    const rec = await s.rec(name);
    await rec.mark('new chat');
    await s.click('.sidebar-item-row', /New chat/);
    await s.sleep(3000);
    await rec.stop();
  },
};

(async () => {
  const run = PHASES[process.argv[2]];
  if (!run) { console.error(`phases: ${Object.keys(PHASES).join(', ')}`); process.exit(1); }
  const s = await session({
    tab: (u) => u.startsWith('http://localhost:3000') && !u.includes('/media'),
    out: 'tools/ui-research/captures/willow/home-glow',
    front: true,
  });
  try { await run(s); } finally { await s.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
