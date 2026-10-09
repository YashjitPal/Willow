/**
 * Scrolls a task conversation up by a screen and a half, then measures the scroll-to-latest
 * button that appears (box, surface, glyph). Scrolling only; nothing is pressed.
 *
 *   node tools/scratch/jump-button.cjs gemini|willow [--restore]
 */
const puppeteer = require('puppeteer-core');

const CONFIG = {
  gemini: { origin: 'https://gemini.google.com', scroller: 'infinite-scroller.chat-history, .chat-history' },
  willow: { origin: 'http://localhost:3000', scroller: '.spark-task-detail__conversation-scroll' },
};

(async () => {
  const which = process.argv[2] || 'gemini';
  const restore = process.argv.includes('--restore');
  const cfg = CONFIG[which];
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith(cfg.origin));
  await page.bringToFront();
  const out = await page.evaluate(async (c, back) => {
    const r1 = (n) => Math.round(n * 10) / 10;
    const scroller = [...document.querySelectorAll(c.scroller)].find((el) => el.scrollHeight > el.clientHeight);
    if (!scroller) return 'no scrollable conversation';
    if (back) {
      scroller.scrollTop = scroller.scrollHeight;
      return 'scrolled to the bottom';
    }
    scroller.scrollTop = scroller.scrollHeight;
    await new Promise((resolve) => setTimeout(resolve, 400));
    scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight * 2.5);
    scroller.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 900));
    const candidates = [...document.querySelectorAll('button')].filter((button) => {
      const r = button.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const text = `${button.getAttribute('aria-label') || ''} ${button.className} ${button.textContent}`.toLowerCase();
      return /bottom|latest|arrow_downward|scroll/.test(text);
    });
    if (!candidates.length) return 'no jump button visible';
    return candidates.map((button) => {
      const r = button.getBoundingClientRect();
      const cs = getComputedStyle(button);
      const icon = button.querySelector('mat-icon, .luminous-symbols, .google-symbols, [class*="symbol"]');
      const ib = icon?.getBoundingClientRect();
      const ics = icon ? getComputedStyle(icon) : null;
      return `<${button.className.toString().split(/\s+/).slice(0, 3).join('.')}> aria "${button.getAttribute('aria-label') || ''}" [${[r.x, r.y, r.width, r.height].map(r1).join(',')}] bg ${cs.backgroundColor} r ${cs.borderRadius} border ${cs.borderTopWidth} ${cs.borderTopColor} shadow ${cs.boxShadow} color ${cs.color}`
        + (ib ? `\n    glyph "${icon.getAttribute('fonticon') || icon.textContent.trim()}" [${[ib.x, ib.y, ib.width, ib.height].map(r1).join(',')}] ${ics.fontSize} w${ics.fontWeight} ${ics.color}` : '');
    }).join('\n');
  }, cfg, restore);
  console.log(`${which}: ${out}`);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
