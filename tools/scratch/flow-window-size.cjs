// Resizes the #willow-probe Flow window (tools/scratch/flow-window.cjs) and only that window.
//   node tools/scratch/flow-window-size.cjs <outerWidth> <outerHeight> | max
const puppeteer = require('puppeteer-core');

const MARK = '#willow-probe';
const [w, h] = process.argv.slice(2);

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const session = await browser.target().createCDPSession();
  const { targetInfos } = await session.send('Target.getTargets');
  // Flow tabs only: other agents' tabs (Gemini Spark's) carry #willow-probe too.
  const mine = targetInfos.find((t) => t.type === 'page' && t.url.includes(MARK) && t.url.includes('flow.google.com'));
  if (!mine) throw new Error('no #willow-probe window');
  const { windowId } = await session.send('Browser.getWindowForTarget', { targetId: mine.targetId });
  if (w === 'max') {
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
  } else {
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await session.send('Browser.setWindowBounds', { windowId, bounds: { left: 0, top: 0, width: Number(w), height: Number(h) } });
  }
  const { bounds } = await session.send('Browser.getWindowBounds', { windowId });
  console.log(JSON.stringify(bounds));
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
