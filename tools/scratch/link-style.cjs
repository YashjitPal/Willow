/**
 * Colour and underline of the first visible link inside a reply.
 *
 *   node tools/scratch/link-style.cjs gemini|willow
 */
const puppeteer = require('puppeteer-core');

const CONFIG = {
  gemini: { origin: 'https://gemini.google.com', link: 'message-content a[href]' },
  willow: { origin: 'http://localhost:3000', link: '.spark-task-detail .smd-root a[href]' },
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
  const synthetic = process.argv.includes('--synthetic');
  const out = await page.evaluate((sel, makeOne) => {
    let probe = null;
    if (makeOne) {
      // No seeded reply carries a link: borrow the first paragraph of a mounted reply.
      const host = document.querySelector('.spark-task-detail .smd-root p');
      if (!host) return '(no reply paragraph)';
      probe = document.createElement('a');
      probe.className = 'smd-link';
      probe.href = '#probe';
      probe.textContent = 'probe';
      host.appendChild(probe);
    }
    const links = [...document.querySelectorAll(sel)];
    const el = links.find((a) => a.getBoundingClientRect().width > 0) || links[0];
    if (!el) return '(no link)';
    const cs = getComputedStyle(el);
    const result = [
      `"${el.textContent.trim().slice(0, 30)}" of ${links.length}`,
      `color ${cs.color} | w${cs.fontWeight} | deco ${cs.textDecorationLine} ${cs.textDecorationStyle} ${cs.textDecorationColor} ${cs.textDecorationThickness} | offset ${cs.textUnderlineOffset}`,
    ].join('\n  ');
    probe?.remove();
    return result;
  }, cfg.link, synthetic);
  console.log(`${which}: ${out}`);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
