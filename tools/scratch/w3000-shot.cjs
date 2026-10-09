// Read-only: a screenshot of the user's :3000 Media tab as it is now, plus where its collection
// tiles are and how big. No input, no navigation.
//   node tools/scratch/w3000-shot.cjs <out.png>
const fs = require('fs');
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000/media'));
  if (!page) { console.log('no :3000 media tab'); await browser.disconnect(); return; }
  console.log(page.url());
  console.log(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-drop-collection]')].map((t) => {
    const r = t.getBoundingClientRect();
    return { rect: [r.x, r.y, r.width, r.height].map(Math.round), title: t.querySelector('.ct-title-text')?.textContent, thumbs: t.querySelectorAll('.ct-thumb').length };
  }))));
  const cdp = await page.createCDPSession();
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(process.argv[2], Buffer.from(data, 'base64'));
  await cdp.detach();
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
