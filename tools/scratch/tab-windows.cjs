// Read-only: every page in the debug Chrome with its window, bounds and visibility state.
//   node tools/scratch/tab-windows.cjs
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const session = await browser.target().createCDPSession();
  const { targetInfos } = await session.send('Target.getTargets');
  for (const t of targetInfos.filter((x) => x.type === 'page')) {
    const { windowId, bounds } = await session.send('Browser.getWindowForTarget', { targetId: t.targetId }).catch(() => ({}));
    const target = browser.targets().find((x) => x._targetId === t.targetId || x._targetInfo?.targetId === t.targetId);
    let visibility = '?';
    try {
      const cdp = await target.createCDPSession();
      const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.visibilityState + " " + innerWidth + "x" + innerHeight + " outer " + outerWidth + "x" + outerHeight + " dpr " + devicePixelRatio', returnByValue: true });
      visibility = result.value;
      await cdp.detach();
    } catch (e) { visibility = `(${e.message.slice(0, 40)})`; }
    console.log(`window ${windowId} ${bounds ? `${bounds.left},${bounds.top} ${bounds.width}x${bounds.height} ${bounds.windowState}` : ''} | ${visibility} | ${t.url.slice(0, 90)}`);
  }
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
