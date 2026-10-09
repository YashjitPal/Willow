/**
 * Willow (Gems/chat tab): routes to a page, waits for a root selector to appear, then
 * prints boxes and key styles for the given part selectors (relative to the page root)
 * and saves a screenshot. Text is never printed. Read-only.
 *
 *   node tools/scratch/page-probe.cjs <path> "<root selector>" "<part>" ... [--shot=name]
 */
const fs = require('fs');
const puppeteer = require('puppeteer-core');

(async () => {
  const args = process.argv.slice(2);
  const shot = (args.find((a) => a.startsWith('--shot=')) || '').slice(7);
  const [path, rootSel, ...parts] = args.filter((a) => !a.startsWith('--'));
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  await page.bringToFront();
  if (new URL(page.url()).pathname !== path) {
    await page.evaluate((to) => { history.pushState({}, '', to); dispatchEvent(new PopStateEvent('popstate')); }, path);
  }
  let found = false;
  for (let i = 0; i < 40 && !found; i++) {
    await new Promise((r) => setTimeout(r, 250));
    found = await page.evaluate((s) => !!document.querySelector(s), rootSel);
  }
  if (!found) { console.log(`root ${rootSel} not found on ${page.url()}`); browser.disconnect(); return; }
  await new Promise((r) => setTimeout(r, 600));
  console.log(await page.evaluate((rs, list) => {
    const root = document.querySelector(rs);
    const r1 = (n) => Math.round(n * 10) / 10;
    const describe = (el, label) => {
      const b = el.getBoundingClientRect();
      const c = getComputedStyle(el);
      return `${label} [${[b.x, b.y, b.width, b.height].map(r1)}] ${c.fontSize}/${c.lineHeight} w${c.fontWeight} color ${c.color} bg ${c.backgroundColor} pad ${c.padding} margin ${c.margin} r ${c.borderRadius} fvs ${c.fontVariationSettings}`;
    };
    const out = [describe(root, `ROOT ${rs}`)];
    for (const sel of list) {
      const el = root.querySelector(sel);
      out.push(el ? describe(el, sel) : `${sel}: none`);
    }
    return out.join('\n');
  }, rootSel, parts));
  if (shot) {
    const cdp = await page.createCDPSession();
    const data = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${process.env.TEMP}/${shot}.png`, Buffer.from(data.data, 'base64'));
    await cdp.detach();
  }
  browser.disconnect();
})();
