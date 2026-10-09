// Reports the debug Chrome's windows (state, bounds) and which tab is in front of each. Read-only.
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  try {
    const session = await browser.target().createCDPSession();
    const { targetInfos } = await session.send('Target.getTargets');
    const seen = new Map();
    for (const t of targetInfos.filter((x) => x.type === 'page')) {
      const { windowId, bounds } = await session.send('Browser.getWindowForTarget', { targetId: t.targetId }).catch(() => ({}));
      if (!windowId) continue;
      if (!seen.has(windowId)) seen.set(windowId, { bounds, tabs: [] });
      seen.get(windowId).tabs.push(`${t.attached ? '*' : ' '} ${t.url.slice(0, 70)}`);
    }
    for (const [id, w] of seen) console.log(`window ${id}: ${w.bounds.windowState} ${w.bounds.left},${w.bounds.top} ${w.bounds.width}x${w.bounds.height}\n  ${w.tabs.join('\n  ')}`);
  } finally { browser.disconnect(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
