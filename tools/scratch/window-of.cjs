/**
 * Which browser window each page of the debug Chrome is in, so a work window whose site dropped
 * its marker can be told from the user's tabs: a work window holds only its own page.
 * `close <exact url>` closes that page only when it is alone in its window.
 *
 *   node tools/scratch/window-of.cjs list
 *   node tools/scratch/window-of.cjs close <exact url>
 */
const puppeteer = require('puppeteer-core');

const [cmd = 'list', url] = process.argv.slice(2);

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const session = await browser.target().createCDPSession();
  const { targetInfos } = await session.send('Target.getTargets');
  const pages = targetInfos.filter((t) => t.type === 'page');
  const windows = new Map();
  for (const page of pages) {
    const { windowId } = await session.send('Browser.getWindowForTarget', { targetId: page.targetId }).catch(() => ({ windowId: -1 }));
    page.windowId = windowId;
    windows.set(windowId, (windows.get(windowId) ?? 0) + 1);
  }
  if (cmd === 'list') {
    for (const page of pages) console.log(`window ${page.windowId} (${windows.get(page.windowId)} pages)  ${page.url.slice(0, 120)}`);
  } else if (cmd === 'close') {
    const matches = pages.filter((page) => page.url === url);
    if (matches.length !== 1) throw new Error(`${matches.length} pages are at ${url}; close needs exactly one`);
    const [page] = matches;
    if (windows.get(page.windowId) !== 1) throw new Error(`window ${page.windowId} holds ${windows.get(page.windowId)} pages: not a work window`);
    await session.send('Target.closeTarget', { targetId: page.targetId });
    console.log(`closed window ${page.windowId}`);
  }
  await browser.disconnect();
})().catch((error) => { console.error(error); process.exit(1); });
