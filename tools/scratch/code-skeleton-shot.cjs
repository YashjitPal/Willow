/**
 * Willow (never the media tab): reloads the Code landing with the lazy CodeHome module's
 * request held, so the Suspense fallback (CodeWorkspaceSkeleton) stays up, then records a
 * screenshot and the skeleton's box geometry before letting the request through.
 *
 *   node tools/scratch/code-skeleton-shot.cjs [out.png]
 */
const path = require('path');
const os = require('os');
const puppeteer = require('puppeteer-core');

(async () => {
  const out = process.argv[2] || path.join(os.tmpdir(), 'willow-emulator', 'code-skeleton.png');
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  if (!page) throw new Error('no Willow tab');
  const client = await page.target().createCDPSession();
  const held = [];
  client.on('Fetch.requestPaused', (e) => held.push(e.requestId));
  await client.send('Fetch.enable', { patterns: [{ urlPattern: '*features/code/src/CodeHome.tsx*', requestStage: 'Request' }] });
  try {
    await page.goto('http://localhost:3000/?mode=develop', { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + 30000;
    while (!held.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 2500));
    const boxes = await page.evaluate(() => {
      const root = document.querySelector('.code-hero');
      if (!root) return null;
      const pick = (sel) => [...root.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().height > 0).map((e) => {
        const r = e.getBoundingClientRect();
        return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',');
      });
      return {
        live: !!document.querySelector('.code-idle'),
        title: pick('.code-hero-title'),
        pills: pick('.code-hero-pills'),
        cards: pick('.code-bento-card'),
        slot: pick('.code-composer-spacer'),
      };
    });
    await page.screenshot({ path: out });
    console.log(held.length ? 'held CodeHome' : 'CodeHome never requested', JSON.stringify(boxes));
    console.log('screenshot', out);
  } finally {
    for (const id of held) await client.send('Fetch.continueRequest', { requestId: id }).catch(() => {});
    await client.send('Fetch.disable').catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
    browser.disconnect();
  }
})();
