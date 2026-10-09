/**
 * Expands the latest reply's processing pill (an inline accordion in both apps) and lists the
 * revealed rows relative to the pill: each row's glyph box and label box with its type.
 * Run it again to collapse. Animations are disabled while reading.
 *
 *   node tools/scratch/processing-expand.cjs gemini|willow [--read-only]
 */
const puppeteer = require('puppeteer-core');

const CONFIG = {
  gemini: {
    origin: 'https://gemini.google.com',
    trigger: 'button.processing-state-container-button',
    rows: '.state-header',
    icon: 'gem-icon, .tool-image-container',
    label: '.thought-content, .processing-state-text',
  },
  willow: {
    origin: 'http://localhost:3000',
    trigger: 'button.spark-task-detail__processing-trigger',
    rows: '.spark-task-detail__processing-tool, .spark-task-detail__narration-row, [class*="narration"] > div, [class*="processing-step"]',
    icon: '.spark-task-detail__processing-node, .luminous-symbols, .google-symbols, img',
    label: 'span:last-child, p',
  },
};

(async () => {
  const which = process.argv[2] || 'gemini';
  const readOnly = process.argv.includes('--read-only');
  const cfg = CONFIG[which];
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith(cfg.origin));
  await page.bringToFront();
  const out = await page.evaluate(async (c, onlyRead) => {
    const r1 = (n) => Math.round(n * 10) / 10;
    const triggers = [...document.querySelectorAll(c.trigger)].filter((el) => el.getBoundingClientRect().height > 0);
    const trigger = triggers[triggers.length - 1];
    if (!trigger) return 'no trigger';
    trigger.scrollIntoView({ block: 'start' });
    if (!onlyRead) trigger.click();
    await new Promise((resolve) => setTimeout(resolve, 700));
    const style = document.createElement('style');
    style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
    document.head.appendChild(style);
    const t = trigger.getBoundingClientRect();
    const scope = trigger.parentElement;
    const lines = [`trigger [${[t.x, t.y, t.width, t.height].map(r1).join(',')}] expanded ${trigger.getAttribute('aria-expanded')}`];
    const rows = [...scope.querySelectorAll(c.rows)].filter((row) => row.getBoundingClientRect().height > 0).slice(0, 8);
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      const icon = row.querySelector(c.icon);
      const label = [...row.querySelectorAll(c.label)].find((el) => el.textContent.trim() && !icon?.contains(el));
      const ib = icon?.getBoundingClientRect();
      const lb = label?.getBoundingClientRect();
      const lcs = label ? getComputedStyle(label) : null;
      lines.push(`  row dx ${r1(r.x - t.x)} dy ${r1(r.y - t.bottom)} h ${r1(r.height)}`
        + (ib ? ` | icon dx ${r1(ib.x - t.x)} ${r1(ib.width)}x${r1(ib.height)}` : '')
        + (lb ? ` | label dx ${r1(lb.x - t.x)} dy ${r1(lb.y - r.y)} "${label.textContent.trim().slice(0, 28)}" ${lcs.fontSize}/${lcs.lineHeight} w${lcs.fontWeight} ${lcs.color}` : ''));
    }
    style.remove();
    return lines.join('\n');
  }, cfg, readOnly);
  console.log(`${which}:\n${out}`);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
