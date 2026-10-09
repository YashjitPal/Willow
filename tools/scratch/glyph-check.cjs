/**
 * Which icon faces Willow loads draw a ligature: one em square when they do, the name's own
 * letters when they don't. Usage: node glyph-check.cjs schedule_auto,info,more_vert
 */
const puppeteer = require('puppeteer-core');

const BASE = 'http://localhost:3000';
const NAMES = (process.argv[2] || 'schedule_auto,info,more_vert,edit,delete').split(',');
const FACES = ['Google Symbols', 'Material Symbols Rounded', 'Luminous Symbols'];

(async () => {
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 30_000 });
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 4000));
    const out = await page.evaluate(async (names, faces) => {
      await document.fonts.ready;
      const result = {};
      for (const face of faces) {
        try { await document.fonts.load(`400 20px "${face}"`, names.join(' ')); } catch { /* not declared */ }
      }
      for (const name of names) {
        result[name] = {};
        for (const face of faces) {
          const s = document.createElement('span');
          s.style.cssText = `position:absolute;left:-9999px;font-size:20px;line-height:1;white-space:nowrap;font-feature-settings:"liga";font-family:"${face}"`;
          s.textContent = name;
          document.body.appendChild(s);
          const width = s.getBoundingClientRect().width;
          s.remove();
          result[name][face] = width <= 26 ? 'yes' : `no (${Math.round(width)}px)`;
        }
      }
      return result;
    }, NAMES, FACES);
    console.table(out);
  } finally {
    await context.close();
    browser.disconnect();
  }
})().catch((error) => { console.error(error); process.exit(1); });
