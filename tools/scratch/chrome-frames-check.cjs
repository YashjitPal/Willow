/**
 * Whether the debug Chrome is producing frames (requestAnimationFrame fires), and
 * whether restoring its window over DevTools makes it. Opens and closes one blank tab.
 *
 *   node tools/scratch/chrome-frames-check.cjs [--restore]
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const restore = process.argv.includes('--restore');
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = await browser.newPage();
  try {
    await page.goto('about:blank');
    await page.bringToFront();
    const session = await page.createCDPSession();
    const { windowId, bounds } = await session.send('Browser.getWindowForTarget');
    console.log('window', windowId, JSON.stringify(bounds));
    const probe = () => page.evaluate(() => new Promise((resolve) => {
      let frames = 0;
      const started = performance.now();
      const step = () => { frames += 1; if (performance.now() - started < 500) requestAnimationFrame(step); };
      requestAnimationFrame(step);
      setTimeout(() => resolve({ frames, visibility: document.visibilityState, focus: document.hasFocus() }), 600);
    }));
    console.log('before:', JSON.stringify(await probe()));
    if (restore) {
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
      await new Promise((resolve) => setTimeout(resolve, 400));
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      await new Promise((resolve) => setTimeout(resolve, 600));
      await page.bringToFront();
      console.log('after restore:', JSON.stringify(await probe()));
    }
  } finally {
    await page.close();
    browser.disconnect();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
