/**
 * Types into the notebook create screen's name field (real key events, never Enter) and
 * reports the field, the submit button and its glyph; or clears the field again.
 *
 *   node tools/scratch/nb-type.cjs gemini|willow "Some title"
 *   node tools/scratch/nb-type.cjs gemini|willow --clear
 */
const puppeteer = require('puppeteer-core');

const CONFIG = {
  gemini: {
    origin: 'https://gemini.google.com',
    input: 'input.project-name-input',
    submit: 'project-create-window-v2 form button, project-create-window-v2 form gem-icon-button',
  },
  willow: { origin: 'http://localhost:3000', input: '.nb-create-input', submit: '.nb-create-submit' },
};

(async () => {
  const [which = 'willow', text] = process.argv.slice(2);
  const cfg = CONFIG[which];
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith(cfg.origin));
  await page.bringToFront();
  await page.focus(cfg.input);
  if (text === '--clear') {
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
  } else if (text) {
    if (text.includes('\n')) throw new Error('refusing to type a newline');
    await page.keyboard.type(text, { delay: 30 });
  }
  await new Promise((resolve) => setTimeout(resolve, 700));
  const out = await page.evaluate((c) => {
    const r1 = (n) => Math.round(n * 10) / 10;
    const box = (el) => { const r = el.getBoundingClientRect(); return `[${[r.x, r.y, r.width, r.height].map(r1).join(',')}]`; };
    const input = document.querySelector(c.input);
    const lines = [`value ${JSON.stringify(input.value)} input ${box(input)}`];
    const submits = [...document.querySelectorAll(c.submit)].filter((el) => el.getBoundingClientRect().width > 0);
    for (const el of submits) {
      const cs = getComputedStyle(el);
      const glyph = el.querySelector('mat-icon, .luminous-symbols, [class*="symbol"]');
      const gcs = glyph ? getComputedStyle(glyph) : null;
      lines.push(`submit <${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/).slice(0, 2).join('.')}> ${box(el)} bg ${cs.backgroundColor} r ${cs.borderRadius} color ${cs.color} label "${el.getAttribute('aria-label') || ''}"`
        + (glyph ? `\n    glyph ${box(glyph)} ${gcs.fontSize} w${gcs.fontWeight} ${gcs.color}` : ''));
    }
    if (!submits.length) lines.push('no submit button');
    return lines.join('\n');
  }, cfg);
  console.log(`${which}: ${out}`);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
