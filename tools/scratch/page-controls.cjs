/**
 * Lists every visible control on the current page of the Gemini or Willow tab — links,
 * buttons, switches, inputs — with its label, href, role, state and box. Read-only: it
 * clicks nothing, so it is the safe first look at a settings page.
 *
 *   node tools/scratch/page-controls.cjs gemini|willow
 */
const puppeteer = require('puppeteer-core');

const ORIGINS = { gemini: 'https://gemini.google.com', willow: 'http://localhost:3000' };

(async () => {
  const which = process.argv[2] || 'gemini';
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith(ORIGINS[which] || 'x'))
    || (await browser.pages()).find((p) => p.url().includes(which));
  if (!page) throw new Error(`no ${which} tab`);
  const rows = await page.evaluate(() => {
    const round = (n) => Math.round(n);
    const skip = (el) => el.closest('bard-sidenav, .studio-sidebar, .cdk-overlay-container');
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      for (let n = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      }
      return true;
    };
    return [...document.querySelectorAll('a[href], button, [role="button"], [role="switch"], [role="link"], input, textarea, select, [contenteditable="true"]')]
      .filter((el) => shown(el) && !skip(el))
      .map((el) => {
        const r = el.getBoundingClientRect();
        const label = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.value || '')
          .replace(/\s+/g, ' ').trim().slice(0, 70);
        const state = [
          el.getAttribute('aria-checked') && `checked=${el.getAttribute('aria-checked')}`,
          el.getAttribute('aria-pressed') && `pressed=${el.getAttribute('aria-pressed')}`,
          el.disabled && 'disabled',
          el.getAttribute('aria-disabled') === 'true' && 'aria-disabled',
        ].filter(Boolean).join(' ');
        return `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[${el.getAttribute('role')}]` : ''} [${[r.x, r.y, r.width, r.height].map(round).join(',')}] "${label}"${el.getAttribute('href') ? ` href=${el.getAttribute('href').slice(0, 80)}` : ''}${state ? ` ${state}` : ''}`;
      });
  });
  console.log(`${page.url()}\n${rows.join('\n')}`);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
