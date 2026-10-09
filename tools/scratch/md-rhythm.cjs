/**
 * The vertical rhythm of the richest reply on the current Spark task page: its first N
 * top-level blocks (and the first item of each list) with their top and height relative to
 * the reply, and the gap from the previous block. Run on both apps and compare.
 *
 *   node tools/scratch/md-rhythm.cjs gemini|willow [count=16]
 */
const puppeteer = require('puppeteer-core');

const ORIGINS = { gemini: 'https://gemini.google.com', willow: 'http://localhost:3000' };

(async () => {
  const which = process.argv[2] || 'gemini';
  const count = Number(process.argv[3] || 16);
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith(ORIGINS[which]));
  const out = await page.evaluate((app, n) => {
    const replies = [...document.querySelectorAll(app === 'gemini'
      ? 'message-content'
      : '.spark-task-detail__response-body, .spark-task-detail__assistant-response')];
    const weight = (el) => el.querySelectorAll('h1, h2, h3, h4, ul, ol, li, table, hr').length;
    const root = replies.sort((a, b) => weight(b) - weight(a))[0];
    if (!root) return 'no reply';
    // Descend through single wrappers to the element that holds the markdown blocks.
    let host = root;
    while (host.children.length === 1 && host.firstElementChild.children.length) host = host.firstElementChild;
    const top = host.getBoundingClientRect().top;
    let prevBottom = null;
    const lines = [];
    for (const block of [...host.children].slice(0, n)) {
      const r = block.getBoundingClientRect();
      const cs = getComputedStyle(block);
      const gap = prevBottom === null ? '' : ` gap ${Math.round((r.top - prevBottom) * 10) / 10}`;
      lines.push(`${block.tagName.toLowerCase().padEnd(6)} y ${String(Math.round((r.top - top) * 10) / 10).padStart(7)} h ${String(Math.round(r.height * 10) / 10).padStart(6)}${gap} | mt ${cs.marginTop} mb ${cs.marginBottom} | "${(block.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 36)}"`);
      if (/^(UL|OL)$/.test(block.tagName)) {
        const items = [...block.children].slice(0, 2);
        for (const li of items) {
          const lr = li.getBoundingClientRect();
          const lcs = getComputedStyle(li);
          lines.push(`   li   y ${String(Math.round((lr.top - top) * 10) / 10).padStart(7)} h ${String(Math.round(lr.height * 10) / 10).padStart(6)} | mt ${lcs.marginTop} mb ${lcs.marginBottom}`);
        }
      }
      prevBottom = r.bottom;
    }
    return lines.join('\n');
  }, which, count);
  console.log(out);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
