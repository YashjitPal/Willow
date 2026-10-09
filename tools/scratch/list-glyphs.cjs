/**
 * Where a Spark reply's list actually paints: the first paragraph's text, the first list
 * item's text and its bullet (the `::before` box when the list draws its own), as glyph
 * positions rather than element boxes. Animations off while reading.
 *
 *   node tools/scratch/list-glyphs.cjs gemini|willow
 */
const puppeteer = require('puppeteer-core');

const CONFIG = {
  gemini: { origin: 'https://gemini.google.com', reply: 'message-content' },
  willow: { origin: 'http://localhost:3000', reply: '.spark-task-detail__response-body, .spark-task-detail__assistant-response' },
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
    const textX = (el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        const rect = range.getClientRects()[0];
        if (rect) return r1(rect.x);
      }
      return '-';
    };
    const roots = [...document.querySelectorAll(c.reply)];
    const root = roots.sort((a, b) => b.querySelectorAll('ul').length - a.querySelectorAll('ul').length)[0];
    const p = root.querySelector('p');
    const li = root.querySelector('ul > li');
    const before = li ? getComputedStyle(li, '::before') : null;
    const liBox = li?.getBoundingClientRect();
    const bullet = before && before.content !== 'none'
      ? `::before left ${before.left} width ${before.width} → x ${r1(liBox.x + parseFloat(before.left || '0'))}`
      : `marker ${li ? getComputedStyle(li).listStyleType : '-'}`;
    const result = `p text x ${p ? textX(p) : '-'} | li text x ${li ? textX(li) : '-'} | li box x ${li ? r1(liBox.x) : '-'} | bullet ${bullet}`;
    style.remove();
    return result;
  }, cfg);
  console.log(`${which}: ${out}`);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
