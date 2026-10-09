// A Flow tab in a window of its own, so bringing it forward never hides another agent's tab in
// the main window. `open` makes it (maximized, like the main window) unless one is already open;
// `close` closes it. The tab is found again by the #willow-probe fragment.
//   node tools/scratch/flow-window.cjs open|close [projectUrl]
const puppeteer = require('puppeteer-core');

const MARK = '#willow-probe';
const [cmd = 'open', url = 'https://flow.google.com/project/eb4308cd-f6c9-43e9-85fd-ea2acd8584c8'] = process.argv.slice(2);

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const session = await browser.target().createCDPSession();
  const { targetInfos } = await session.send('Target.getTargets');
  // Flow tabs only: other agents' tabs (Gemini Spark's) carry #willow-probe too, and `close`
  // would close them.
  const mine = targetInfos.filter((t) => t.type === 'page' && t.url.includes(MARK) && t.url.includes('flow.google.com'));
  if (cmd === 'close') {
    for (const t of mine) await session.send('Target.closeTarget', { targetId: t.targetId });
    console.log(`closed ${mine.length}`);
  } else if (mine.length) {
    console.log(`already open: ${mine[0].url}`);
  } else {
    const { targetId } = await session.send('Target.createTarget', { url: `${url}${MARK}`, newWindow: true });
    const { windowId } = await session.send('Browser.getWindowForTarget', { targetId });
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
    console.log(`opened ${targetId} in window ${windowId}`);
  }
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
