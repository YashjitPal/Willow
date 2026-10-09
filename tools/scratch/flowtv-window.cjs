// Flow TV (labs.google/flow/tv) in a window of its own in the debug Chrome. Its router drops a
// #marker as soon as it lands on a channel, so the window is known by its target id, saved in
// tools/scratch/.flowtv-target.json: `open` makes one (maximized) unless it exists, `close` closes
// it, `goto <url>` navigates it. Nothing else in the browser is touched.
//   node tools/scratch/flowtv-window.cjs open|close|goto [url]
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const TARGET_FILE = path.join(__dirname, '.flowtv-target.json');
const [cmd = 'open', arg = 'https://labs.google/flow/tv'] = process.argv.slice(2);
const savedId = () => { try { return JSON.parse(fs.readFileSync(TARGET_FILE, 'utf8')).targetId; } catch { return null; } };

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  try {
    const session = await browser.target().createCDPSession();
    const { targetInfos } = await session.send('Target.getTargets');
    const mine = targetInfos.find((t) => t.type === 'page' && t.targetId === savedId());
    if (cmd === 'close') {
      if (mine) await session.send('Target.closeTarget', { targetId: mine.targetId });
      fs.rmSync(TARGET_FILE, { force: true });
      console.log(mine ? 'closed' : 'nothing to close');
    } else if (cmd === 'goto') {
      if (!mine) throw new Error('no Flow TV probe window: run open first');
      const page = await browser.targets().find((t) => t._targetId === mine.targetId).page();
      await page.goto(arg, { waitUntil: 'domcontentloaded', timeout: 60000 });
      console.log(page.url());
    } else if (mine) {
      console.log(`already open: ${mine.url}`);
    } else {
      const { targetId } = await session.send('Target.createTarget', { url: arg, newWindow: true });
      const { windowId } = await session.send('Browser.getWindowForTarget', { targetId });
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
      fs.writeFileSync(TARGET_FILE, JSON.stringify({ targetId }));
      console.log(`opened ${targetId} in window ${windowId}`);
    }
  } finally {
    await browser.disconnect();
  }
})().catch((e) => { console.error(e); process.exit(1); });
