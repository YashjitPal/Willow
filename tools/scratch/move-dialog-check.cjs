/**
 * Read-only: the open Move/Add-to-notebook dialog's list scroll offset and the first row's
 * glyph and label positions, in Gemini or Willow.
 *
 *   node tools/scratch/move-dialog-check.cjs gemini|willow
 */
const puppeteer = require('puppeteer-core');

const CONFIG = {
  gemini: { origin: 'https://gemini.google.com', list: 'move-to-project-dialog mat-dialog-content', icon: 'move-to-project-dialog mat-icon.lumi-symbols', label: 'move-to-project-dialog .gds-label-l' },
  willow: { origin: 'http://localhost:3000', list: '.nb-move-list', icon: '.nb-move-row-icon', label: '.nb-move-row-label' },
};

(async () => {
  const which = process.argv[2] || 'willow';
  const cfg = CONFIG[which];
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith(cfg.origin));
  const out = await page.evaluate((c) => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return '-';
      const r = el.getBoundingClientRect();
      return `[${[r.x, r.y, r.width, r.height].map((v) => v.toFixed(1)).join(',')}]`;
    };
    const list = document.querySelector(c.list);
    return `scrollTop ${list ? list.scrollTop : '-'} | icon ${box(c.icon)} | label ${box(c.label)}`;
  }, cfg);
  console.log(`${which}: ${out}`);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
