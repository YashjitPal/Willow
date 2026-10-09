/**
 * The typography of a reply's markdown on the current Spark task page, one line per element
 * kind (the first visible h1–h4, p, li, ul, strong, a, hr, code, table): box, size, line
 * height, weight, axes, colour and margins. Run it on both apps and compare line by line.
 *
 *   node tools/scratch/md-compare.cjs gemini|willow
 */
const puppeteer = require('puppeteer-core');

const ORIGINS = { gemini: 'https://gemini.google.com', willow: 'http://localhost:3000' };
const KINDS = ['h1', 'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'a', 'hr', 'code', 'pre', 'table', 'blockquote'];

(async () => {
  const which = process.argv[2] || 'gemini';
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith(ORIGINS[which]));
  const out = await page.evaluate((app, kinds) => {
    // The reply with the most structure, so headings and lists are there to compare.
    const replies = [...document.querySelectorAll(app === 'gemini'
      ? 'message-content'
      : '.spark-task-detail__response-body, .spark-task-detail__assistant-response')];
    const weight = (el) => el.querySelectorAll('h1, h2, h3, h4, ul, ol, li, strong, a, hr, code, table').length;
    const root = replies.sort((a, b) => weight(b) - weight(a))[0];
    if (!root) return 'no reply';
    return kinds.map((kind) => {
      const el = [...root.querySelectorAll(kind)].find((x) => x.getBoundingClientRect().height > 0);
      if (!el) return `${kind.padEnd(10)} -`;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const rootX = root.getBoundingClientRect().x;
      return `${kind.padEnd(10)} dx ${String(Math.round((r.x - rootX) * 10) / 10).padStart(6)} w ${String(Math.round(r.width)).padStart(4)} | ${cs.fontSize}/${cs.lineHeight} w${cs.fontWeight} ${cs.color} | mar ${cs.marginTop} ${cs.marginBottom} pad ${cs.paddingLeft} | fvs ${cs.fontVariationSettings}${kind === 'hr' ? ` | border ${cs.borderTopWidth} ${cs.borderTopColor}` : ''}`;
    }).join('\n');
  }, which, KINDS);
  console.log(out);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
