/**
 * Where the docked composer sits: the ancestor chain of the composer's text field up to
 * the page (box, padding, margin, background, radius, position) — read-only.
 *
 *   node tools/scratch/composer-geom.cjs gemini|willow [levels=9]
 */
const puppeteer = require('puppeteer-core');

const CONFIG = {
  gemini: { origin: 'https://gemini.google.com', field: 'rich-textarea .ql-editor, rich-textarea [contenteditable], .text-input-field_textarea-wrapper textarea' },
  willow: { origin: 'http://localhost:3000', field: 'textarea' },
};

(async () => {
  const [which = 'gemini', levelsArg = '9'] = process.argv.slice(2);
  const cfg = CONFIG[which];
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith(cfg.origin));
  const out = await page.evaluate((sel, levels) => {
    const fields = [...document.querySelectorAll(sel)].filter((el) => el.getBoundingClientRect().width > 0);
    const field = fields[fields.length - 1];
    if (!field) return 'no composer field';
    const lines = [];
    for (let n = field, i = 0; n && i < levels; n = n.parentElement, i += 1) {
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      const bg = cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? '' : ` bg ${cs.backgroundColor}`;
      lines.push(`<${n.tagName.toLowerCase()} class="${String(n.className).slice(0, 60)}"> [${[r.x, r.y, r.width, r.height].map((v) => v.toFixed(1)).join(',')}]${bg} r ${cs.borderRadius} pad ${cs.padding} mar ${cs.margin} pos ${cs.position}`);
    }
    return lines.join('\n');
  }, cfg.field, Number(levelsArg));
  console.log(`${which}:\n${out}`);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
