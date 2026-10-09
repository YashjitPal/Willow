/**
 * Read-only look at the Gemini Spark thread that is open in the debug Chrome: brings
 * the tab to the front, prints the user bubbles, the confirmation cards (answered or
 * not), any network banner and the side-panel state, and saves a screenshot.
 *
 *   node tools/scratch/spark-thread-probe.cjs [out.png]
 */
const puppeteer = require('puppeteer-core');
const path = require('path');

(async () => {
  const out = process.argv[2] || path.join('tools', 'ui-research', 'captures', 'spark', '134-remote-browser', 'probe.png');
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('https://gemini.google.com/'));
  if (!page) throw new Error('no gemini tab');
  await page.bringToFront();
  await new Promise((r) => setTimeout(r, 1200));
  const facts = await page.evaluate(() => {
    const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    };
    const bubbles = [...document.querySelectorAll('user-query, .user-query-bubble-with-background, [class*="user-query"]')]
      .filter((el) => !el.parentElement?.closest('user-query, [class*="user-query"]'))
      .map((el) => text(el).slice(0, 80));
    const cards = [...document.querySelectorAll('remy-confirmation-card')].map((card) => ({
      box: box(card),
      buttons: [...card.querySelectorAll('button')].map((b) => `${text(b).slice(0, 20) || b.getAttribute('aria-label')}${b.disabled ? ' (disabled)' : ''}`),
    }));
    const banner = [...document.querySelectorAll('*')]
      .filter((el) => el.children.length === 0 && /waiting for network|checking internet/i.test(el.textContent || ''))
      .map((el) => text(el));
    const side = document.querySelector('remy-side-panel');
    return {
      url: location.pathname,
      visibility: document.visibilityState,
      online: navigator.onLine,
      bubbles,
      cards,
      banner,
      side: side ? { cls: side.className, box: box(side) } : null,
      processing: [...document.querySelectorAll('remy-processing-state')].map((el) => text(el).slice(0, 120)),
      header: text(document.querySelector('remy-viewer .header, remy-status-pill')).slice(0, 80),
    };
  });
  console.log(JSON.stringify(facts, null, 1));
  await page.screenshot({ path: out });
  console.log(`shot -> ${out}`);
  browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
