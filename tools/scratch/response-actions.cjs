/**
 * For every response actions toolbar on the current task page (Gemini's
 * `.actions-container-v2`, Willow's `.spark-task-detail__response-actions`): the toolbar's
 * box, its buttons, and the box of the response text right above it, so the gap between
 * the two can be compared. Read-only.
 *
 *   node tools/scratch/response-actions.cjs gemini|willow [index=-1]
 */
const puppeteer = require('puppeteer-core');

const ORIGINS = { gemini: 'https://gemini.google.com', willow: 'http://localhost:3000' };

(async () => {
  const which = process.argv[2] || 'gemini';
  const index = Number(process.argv[3] ?? -1);
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith(ORIGINS[which]));
  if (!page) throw new Error(`no ${which} tab`);
  const out = await page.evaluate((app, idx) => {
    const r1 = (n) => Math.round(n * 10) / 10;
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return `[${[r.x, r.y, r.width, r.height].map(r1).join(',')}]`;
    };
    const bars = [...document.querySelectorAll(app === 'gemini' ? 'div.actions-container-v2' : '.spark-task-detail__response-actions')]
      .filter((el) => el.getBoundingClientRect().width > 0);
    if (!bars.length) return 'no toolbars';
    const bar = bars[idx < 0 ? bars.length + idx : idx];
    bar.scrollIntoView({ block: 'center' });
    const lines = [`${bars.length} toolbars; #${bars.indexOf(bar)}: ${box(bar)} mt ${getComputedStyle(bar).marginTop} gap ${getComputedStyle(bar.firstElementChild || bar).gap}`];
    // The response text above: the last text-bearing block before the bar in document order.
    const turn = bar.closest(app === 'gemini' ? 'model-response, response-container, .response-container' : '.spark-task-detail__assistant-turn') || bar.parentElement;
    const blocks = [...turn.querySelectorAll('p, li, h1, h2, h3, h4, pre, table, .markdown, message-content')]
      .filter((el) => el.getBoundingClientRect().height > 0 && !bar.contains(el)
        && (el.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING));
    const last = blocks[blocks.length - 1];
    if (last) {
      const lr = last.getBoundingClientRect();
      const br = bar.getBoundingClientRect();
      const cs = getComputedStyle(last);
      lines.push(`text above: ${last.tagName.toLowerCase()} ${box(last)} ${cs.fontSize}/${cs.lineHeight} mb ${cs.marginBottom} | gap to toolbar ${r1(br.y - lr.bottom)}`);
    }
    for (const btn of bar.querySelectorAll('button')) {
      if (btn.getBoundingClientRect().width === 0) continue;
      const icon = btn.querySelector('mat-icon, .mat-icon, .luminous-symbols, .google-symbols, svg');
      const ics = icon ? getComputedStyle(icon) : null;
      const bcs = getComputedStyle(btn);
      lines.push(`  ${(btn.getAttribute('aria-label') || '').padEnd(24)} ${box(btn)} pad ${bcs.padding} r ${bcs.borderRadius} color ${bcs.color}`
        + (icon ? ` | icon ${box(icon)} ${ics.fontSize} w${ics.fontWeight} ${ics.color} ${ics.fontVariationSettings}` : ''));
    }
    return lines.join('\n');
  }, which, index);
  console.log(out);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
