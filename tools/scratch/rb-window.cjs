/*
 * Windows of their own for the remote-browser narrow work: Gemini Spark and a Willow test origin,
 * so bringing either forward never hides the user's tabs or another agent's.
 *
 *   node tools/scratch/rb-window.cjs open gemini|willow   [url]
 *   node tools/scratch/rb-window.cjs close gemini|willow|all
 *   node tools/scratch/rb-window.cjs list
 *
 * Gemini's window is the only tab under gemini.google.com/spark (the user's own Gemini tab is a
 * chat under /app), and Willow's is the only one on the test port.
 */
const puppeteer = require('puppeteer-core');

const WILLOW = process.env.WILLOW_URL || 'http://localhost:3101';
const KINDS = {
  gemini: { url: 'https://gemini.google.com/spark?hl=en-IN', matches: (url) => url.startsWith('https://gemini.google.com/spark') },
  willow: { url: `${WILLOW}/spark`, matches: (url) => url.startsWith(`${WILLOW}/`) },
};

(async () => {
  const [cmd = 'list', kind = 'all', url] = process.argv.slice(2);
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const session = await browser.target().createCDPSession();
  const { targetInfos } = await session.send('Target.getTargets');
  const pages = targetInfos.filter((t) => t.type === 'page');
  const mine = (name) => pages.filter((t) => KINDS[name].matches(t.url));
  if (cmd === 'list') {
    for (const name of Object.keys(KINDS)) console.log(name, JSON.stringify(mine(name).map((t) => t.url)));
  } else if (cmd === 'close') {
    for (const name of kind === 'all' ? Object.keys(KINDS) : [kind]) {
      for (const t of mine(name)) await session.send('Target.closeTarget', { targetId: t.targetId });
      console.log(`closed ${mine(name).length} ${name}`);
    }
  } else if (cmd === 'open') {
    if (!KINDS[kind]) throw new Error(`open gemini|willow, not ${kind}`);
    if (mine(kind).length) {
      console.log(`already open: ${mine(kind)[0].url}`);
    } else {
      const { targetId } = await session.send('Target.createTarget', { url: url || KINDS[kind].url, newWindow: true });
      const { windowId } = await session.send('Browser.getWindowForTarget', { targetId });
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
      console.log(`opened ${kind} ${targetId} in window ${windowId}`);
    }
  } else {
    throw new Error(`unknown command ${cmd}`);
  }
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
