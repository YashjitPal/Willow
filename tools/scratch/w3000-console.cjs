// Read-only: the console messages the user's :3000 Media tab has collected (Console.enable replays
// them), plus whether the React root currently holds anything. No clicks, no navigation, no
// emulation — it only attaches, reads and detaches.
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000/media'));
  if (!page) { console.log('no :3000 media tab'); await browser.disconnect(); return; }
  const cdp = await page.createCDPSession();
  const messages = [];
  cdp.on('Console.messageAdded', ({ message }) => messages.push(message));
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => messages.push({ level: 'exception', text: exceptionDetails.exception?.description || exceptionDetails.text }));
  await cdp.send('Console.enable');
  await cdp.send('Runtime.enable');
  await new Promise((r) => setTimeout(r, 1500));
  const state = await page.evaluate(() => ({
    url: location.href,
    rootChildren: document.getElementById('root')?.childElementCount ?? null,
    bodyChildren: [...document.body.children].map((e) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${e.className && typeof e.className === 'string' ? `.${e.className.split(' ')[0]}` : ''}`).slice(0, 12),
    viteOverlay: !!document.querySelector('vite-error-overlay'),
    scenebuilderOpen: !!document.querySelector('.sb-editor, [class*="sb-scenebuilder"], [class*="scene-builder"]'),
    visibility: document.visibilityState,
  }));
  console.log(JSON.stringify(state, null, 1));
  const relevant = messages.filter((m) => m.level === 'error' || m.level === 'exception' || /error|uncaught|failed/i.test(m.text));
  console.log(`${messages.length} messages, ${relevant.length} errors:`);
  for (const m of relevant.slice(-25)) console.log(`[${m.level}] ${String(m.text).slice(0, 600)}${m.url ? `  @ ${m.url.replace(/^.*\/(src|features|platform)\//, '$1/')}:${m.line}` : ''}`);
  await cdp.detach();
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
