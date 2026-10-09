/**
 * Visible buttons in the top 64px of a tab: box, aria-label, icon name, and a selector hint.
 *
 *   node tools/scratch/topbar-buttons.cjs gemini|willow
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const which = process.argv[2] || 'gemini';
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const prefix = which === 'gemini' ? 'https://gemini.google.com' : 'http://localhost:3000';
  const page = (await browser.pages()).find((p) => p.url().startsWith(prefix));
  const out = await page.evaluate(() => {
    const r1 = (n) => Math.round(n * 10) / 10;
    return [...document.querySelectorAll('button, [role="button"], a[href]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top < 64 && r.bottom > 0 && !el.closest('bard-sidenav, .studio-sidebar');
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        const icon = el.querySelector('mat-icon, .luminous-symbols, [class*="symbol"]');
        const iconName = icon ? (icon.getAttribute('fonticon') || icon.dataset?.matIconName || icon.textContent.trim()) : '';
        const cls = String(el.className).split(/\s+/).filter(Boolean).slice(0, 3).join('.');
        return `[${[r.x, r.y, r.width, r.height].map(r1).join(',')}] <${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}> aria "${el.getAttribute('aria-label') || ''}" icon "${iconName}" testid "${el.dataset?.testId || el.getAttribute('data-test-id') || ''}"`;
      }).join('\n');
  });
  console.log(`${which}:\n${out}`);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
