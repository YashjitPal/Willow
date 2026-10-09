// One-off: on :3101, go to the Media home and list the project cards (and whether the disk-made
// "Collections Test" project is among them); with --open, open it.
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

(async () => {
  const s = await session({ tab: 'willow-test', out: 'tools/ui-research/captures/flow/media/willow/collections' });
  await s.page.goto('http://localhost:3101/?mode=media', { waitUntil: 'networkidle2' }).catch(() => {});
  await s.sleep(3500);
  const cards = await s.eval(() => [...document.querySelectorAll('[data-project-id], [data-testid*="project"], a, button')]
    .map((e) => (e.textContent || '').trim().replace(/\s+/g, ' '))
    .filter((t) => /Collections Test|Default Project/.test(t))
    .slice(0, 8));
  console.log(JSON.stringify(cards));
  await s.shot('media-home-opfs');
  if (process.argv.includes('--open')) {
    await s.click('*', /^Collections Test$/, 'last');
    await s.sleep(4000);
    console.log('url', await s.eval(() => location.href));
    await s.shot('opfs-project');
  }
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
