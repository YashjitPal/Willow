/*
 * A window of its own in the debug Chrome for one piece of work, found again by a URL fragment
 * (#<marker>), so bringing it forward never hides the user's tabs or another agent's.
 *
 *   node tools/scratch/own-window.cjs open <marker> <url>
 *   node tools/scratch/own-window.cjs goto <marker> <url>     same window, new address (keeps the marker)
 *   node tools/scratch/own-window.cjs claim <marker> <exact url>   mark again a window of this work whose
 *                                                              site dropped the fragment in a redirect
 *   node tools/scratch/own-window.cjs close <marker>
 *   node tools/scratch/own-window.cjs list
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const [cmd = 'list', marker, url] = process.argv.slice(2);
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const session = await browser.target().createCDPSession();
  const { targetInfos } = await session.send('Target.getTargets');
  const pages = targetInfos.filter((t) => t.type === 'page');
  const mine = pages.filter((t) => marker && t.url.includes(`#${marker}`));
  const withMarker = (address) => `${address.replace(/#.*$/, '')}#${marker}`;
  if (cmd === 'list') {
    for (const t of pages) console.log(`${t.url.includes('#') ? '*' : ' '} ${t.url.slice(0, 140)}`);
  } else if (cmd === 'open') {
    if (!marker || !url) throw new Error('open <marker> <url>');
    if (mine.length) console.log(`already open: ${mine[0].url}`);
    else {
      const { targetId } = await session.send('Target.createTarget', { url: withMarker(url), newWindow: true });
      const { windowId } = await session.send('Browser.getWindowForTarget', { targetId });
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
      console.log(`opened ${targetId} in window ${windowId}`);
    }
  } else if (cmd === 'goto') {
    if (!mine.length) throw new Error(`no window marked #${marker}`);
    const target = browser.targets().find((t) => t._targetId === mine[0].targetId);
    const page = await target.page();
    await page.goto(withMarker(url), { waitUntil: 'domcontentloaded' });
    console.log(`at ${page.url()}`);
  } else if (cmd === 'claim') {
    const exact = pages.filter((t) => t.url === url);
    if (exact.length !== 1) throw new Error(`${exact.length} windows are at ${url}; claim needs exactly one`);
    const target = browser.targets().find((t) => t._targetId === exact[0].targetId);
    const page = await target.page();
    await page.goto(withMarker(url), { waitUntil: 'domcontentloaded' });
    console.log(`at ${page.url()}`);
  } else if (cmd === 'close') {
    for (const t of mine) await session.send('Target.closeTarget', { targetId: t.targetId });
    console.log(`closed ${mine.length}`);
  } else {
    throw new Error(`unknown command ${cmd}`);
  }
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
