/**
 * The scheduled-run header above a Spark reply (schedule glyph, name, dot, time): the row
 * and each child's box and type, plus the gap down to the reply. Animations off.
 *
 *   node tools/scratch/schedule-header.cjs gemini|willow
 */
const puppeteer = require('puppeteer-core');

const CONFIG = {
  gemini: { origin: 'https://gemini.google.com', scope: 'chat-window, .chat-history, main', skip: 'bard-sidenav', reply: 'message-content' },
  willow: { origin: 'http://localhost:3000', scope: '.spark-task-detail__conversation, .spark-task-detail', skip: '.spark-task-detail__task-row, .studio-sidebar', reply: '.spark-task-detail__assistant-response, .smd-root' },
};

(async () => {
  const which = process.argv[2] || 'gemini';
  const cfg = CONFIG[which];
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith(cfg.origin));
  await page.bringToFront();
  const out = await page.evaluate((c) => {
    const style = document.createElement('style');
    style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
    document.head.appendChild(style);
    const r1 = (n) => Math.round(n * 10) / 10;
    const box = (el) => { const r = el.getBoundingClientRect(); return `[${[r.x, r.y, r.width, r.height].map(r1).join(',')}]`; };
    const type = (el) => {
      const cs = getComputedStyle(el);
      return `${cs.fontSize}/${cs.lineHeight} w${cs.fontWeight} ${cs.color} fvs ${cs.fontVariationSettings} ls ${cs.letterSpacing}`;
    };
    const glyphs = [...document.querySelectorAll('mat-icon, .luminous-symbols, [class*="symbol"]')]
      .filter((el) => /^\s*schedule\s*$/.test(el.textContent) || el.getAttribute('fonticon') === 'schedule' || el.dataset?.matIconName === 'schedule')
      .filter((el) => !el.closest(c.skip) && el.getBoundingClientRect().width > 0);
    const rows = [];
    for (const glyph of glyphs) {
      let row = glyph.parentElement;
      while (row && row.children.length < 3 && row.parentElement) row = row.parentElement;
      const cs = getComputedStyle(row);
      rows.push(`row <${row.tagName.toLowerCase()} class="${String(row.className).slice(0, 70)}"> ${box(row)} display ${cs.display} gap ${cs.gap} align ${cs.alignItems} wrap ${cs.flexWrap} pad ${cs.padding} mar ${cs.margin}`);
      rows.push(`  glyph ${box(glyph)} ${type(glyph)}`);
      for (const child of row.children) {
        if (child.contains(glyph)) continue;
        const ccs = getComputedStyle(child);
        rows.push(`  <${child.tagName.toLowerCase()} class="${String(child.className).slice(0, 50)}"> "${child.textContent.trim().slice(0, 34)}" ${box(child)} ${type(child)} | flex ${ccs.flex} ws ${ccs.whiteSpace} minW ${ccs.minWidth}`);
      }
      const reply = [...document.querySelectorAll(c.reply)].find((el) => el.getBoundingClientRect().top > row.getBoundingClientRect().top);
      if (reply) {
        const first = reply.querySelector('p, h1, h2, h3, li') || reply;
        rows.push(`  reply first block ${box(first)} → gap ${r1(first.getBoundingClientRect().top - row.getBoundingClientRect().bottom)}`);
      }
      let prev = row;
      for (let i = 0; i < 4 && prev.parentElement; i += 1) {
        prev = prev.parentElement;
        const pcs = getComputedStyle(prev);
        rows.push(`  up${i + 1} <${prev.tagName.toLowerCase()} class="${String(prev.className).slice(0, 60)}"> ${box(prev)} pad ${pcs.padding} mar ${pcs.margin}`);
      }
    }
    style.remove();
    return rows.join('\n') || '(no schedule header)';
  }, cfg);
  console.log(`${which}:\n${out}`);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
