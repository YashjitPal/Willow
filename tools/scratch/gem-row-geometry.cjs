/**
 * Compares the first My Gems row in Gemini and Willow structurally — every part's box
 * relative to its row, the row pitch, and the list's offset from the "My Gems" header —
 * so differing Gem names do not get in the way. Read-only.
 *
 *   node tools/scratch/gem-row-geometry.cjs
 */
const puppeteer = require('puppeteer-core');

const SPECS = {
  gemini: {
    origin: 'https://gemini.google.com',
    rows: 'all-bots bot-list-row .bot-list-row-container',
    header: 'all-bots .list-header',
    parts: {
      logo: '.bot-logo-text',
      title: '.bot-row .title',
      desc: '.bot-desc',
      share: '.bot-row-actions button:nth-of-type(1), .bot-row-actions span:nth-of-type(1) button',
      edit: '.bot-row-actions span:nth-of-type(2) button',
      more: '.bot-row-actions > button',
    },
  },
  willow: {
    origin: 'http://localhost:3000',
    rows: '.gems-row',
    header: '.gems-list-header',
    parts: {
      logo: '.gem-logo',
      title: '.gems-row-title',
      desc: '.gems-row-description',
      share: '.gems-row-actions button[aria-label="Share"]',
      edit: '.gems-row-actions button[aria-label="Edit Gem"]',
      more: '.gems-row-actions button[aria-haspopup="menu"]',
    },
  },
};

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  for (const [app, spec] of Object.entries(SPECS)) {
    const page = (await browser.pages()).find((p) => p.url().startsWith(spec.origin) && !p.url().includes('/media'));
    if (!page) { console.log(`${app}: no tab`); continue; }
    const out = await page.evaluate((s) => {
      const r1 = (n) => Math.round(n * 10) / 10;
      const rows = [...document.querySelectorAll(s.rows)];
      if (!rows.length) return 'no rows';
      const row = rows[0].getBoundingClientRect();
      const header = document.querySelector(s.header)?.getBoundingClientRect();
      const lines = [`row [${r1(row.width)}x${r1(row.height)}] pitch ${rows[1] ? r1(rows[1].getBoundingClientRect().y - row.y) : '-'} from header bottom ${header ? r1(row.y - header.bottom) : '-'}`];
      for (const [name, sel] of Object.entries(s.parts)) {
        const el = rows[0].querySelector(sel);
        if (!el) { lines.push(`  ${name}: none`); continue; }
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        lines.push(`  ${name}: [${r1(b.x - row.x)},${r1(b.y - row.y)},${r1(b.width)},${r1(b.height)}] ${cs.fontSize}/${cs.lineHeight} w${cs.fontWeight} ${cs.color}${cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? ` bg ${cs.backgroundColor}` : ''}`);
      }
      return lines.join('\n');
    }, spec);
    console.log(`== ${app}\n${out}`);
  }
  browser.disconnect();
})();
