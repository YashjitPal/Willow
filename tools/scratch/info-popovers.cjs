/**
 * Opens each info button inside a root in turn (real mouse clicks), records the popover or
 * tooltip it raises — box, colours, text — and closes it with Escape before the next.
 * Only for info/help buttons, which open read-only notices.
 *
 *   node tools/scratch/info-popovers.cjs gemini|willow "<rootSelector>" ["<buttonSelector>"]
 */
const puppeteer = require('puppeteer-core');

const ORIGINS = { gemini: 'https://gemini.google.com', willow: 'http://localhost:3000' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const [which = 'gemini', root = 'body', buttonSel = 'button.xap-inline-dialog-click, button[aria-label^="More information"]'] = process.argv.slice(2);
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith(ORIGINS[which]));
  if (!page) throw new Error(`no ${which} tab`);
  await page.bringToFront();
  const buttons = await page.$$(`${root} :is(${buttonSel})`);
  for (const [i, button] of buttons.entries()) {
    const box = await button.boundingBox();
    if (!box) continue;
    const label = await button.evaluate((el) => el.getAttribute('aria-label') || '');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(900);
    const found = await page.evaluate(() => {
      const r1 = (n) => Math.round(n * 10) / 10;
      const out = [];
      for (const el of document.querySelectorAll('.tips-card-container, .mat-mdc-tooltip, .mdc-tooltip__surface, [role="tooltip"], xap-inline-dialog-container')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        const cs = getComputedStyle(el);
        out.push(`${el.className.split(' ')[0] || el.tagName.toLowerCase()} [${[r.x, r.y, r.width, r.height].map(r1)}] bg ${cs.backgroundColor} "${el.innerText.replace(/\s+/g, ' ').trim()}"`);
      }
      return out;
    });
    console.log(`#${i} "${label}" at [${[box.x, box.y].map((n) => Math.round(n))}]\n  ${found.join('\n  ') || '(nothing)'}`);
    await page.keyboard.press('Escape');
    await sleep(500);
  }
  browser.disconnect();
})();
