// A Flow tab in a window of its own for the Tools tab captures, so bringing it forward never hides
// another agent's tab or the user's own Flow. It is found again by its target id (saved beside
// this script), not by a URL marker: Flow's router can drop fragments.
//   node tools/scratch/flowtools-window.cjs open [url] | close | goto <url> | url
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const SAVED = path.join(__dirname, '.flowtools-target.json');
const [cmd = 'open', arg = 'https://flow.google.com/'] = process.argv.slice(2);

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const session = await browser.target().createCDPSession();
  const { targetInfos } = await session.send('Target.getTargets');
  const saved = fs.existsSync(SAVED) ? JSON.parse(fs.readFileSync(SAVED, 'utf8')).targetId : null;
  const mine = targetInfos.find((t) => t.type === 'page' && t.targetId === saved);
  if (cmd === 'close') {
    if (mine) await session.send('Target.closeTarget', { targetId: mine.targetId });
    if (fs.existsSync(SAVED)) fs.rmSync(SAVED);
    console.log(mine ? 'closed' : 'nothing to close');
  } else if (cmd === 'url') {
    console.log(mine ? mine.url : 'not open');
  } else if (cmd === 'goto') {
    if (!mine) throw new Error('not open: run open first');
    const target = browser.targets().find((t) => t._targetId === mine.targetId || t._targetInfo?.targetId === mine.targetId);
    const page = await target.page();
    await page.goto(arg, { waitUntil: 'domcontentloaded' }).catch(() => {});
    console.log(`at ${page.url()}`);
  } else if (mine) {
    console.log(`already open: ${mine.url}`);
  } else {
    const { targetId } = await session.send('Target.createTarget', { url: arg, newWindow: true });
    const { windowId } = await session.send('Browser.getWindowForTarget', { targetId });
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
    fs.writeFileSync(SAVED, JSON.stringify({ targetId }));
    console.log(`opened ${targetId} in window ${windowId}`);
  }
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
