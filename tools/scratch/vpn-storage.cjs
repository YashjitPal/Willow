/**
 * Read-only: the CyberGhost extension's own storage keys and the shape of its values (sizes,
 * and any host:port pairs in them), read from its popup page in this work's window.
 *
 *   node tools/scratch/vpn-storage.cjs <marker>
 */
const puppeteer = require('puppeteer-core');

const marker = process.argv[2] || 'willow-library-probe';
const POPUP = 'chrome-extension://ffbkglfijbcbgblgflchnbphjdllaogb/src/popup.html';

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60_000 });
  const target = browser.targets().find((t) => t.type() === 'page' && t.url().includes(`#${marker}`));
  if (!target) throw new Error(`no window marked #${marker}`);
  const page = await target.page();
  await page.goto(`${POPUP}#${marker}`, { waitUntil: 'domcontentloaded' });
  await new Promise((resolve) => setTimeout(resolve, 2500));
  console.log(JSON.stringify(await page.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const session = chrome.storage.session ? await chrome.storage.session.get(null).catch(() => ({})) : {};
    const describe = (store) => Object.fromEntries(Object.entries(store).map(([key, value]) => {
      const text = JSON.stringify(value) ?? '';
      const nodes = [...new Set(text.match(/[\w.-]+\.(?:ninja|net|com|io):\d{2,5}/g) || [])].slice(0, 6);
      return [key, `${typeof value} ${text.length} chars${nodes.length ? ` nodes: ${nodes.join(', ')}` : ''}`];
    }));
    const everyNode = [...new Set((JSON.stringify(all.CG_proxy ?? {}).match(/[\w.-]+\.nodes\.gen4\.ninja:\d{2,5}/g) || []))];
    return { local: describe(all), session: describe(session), everyNode };
  }), null, 1));
  await browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
