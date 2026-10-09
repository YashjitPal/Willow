/**
 * Opens a menu or sheet by a DOM click on its trigger (for when a CDP touch does not
 * register), waits, then dumps every visible overlay surface with its rows. Only for
 * triggers that open UI — never for buttons that act. Close it afterwards with press-key.
 *
 *   node tools/scratch/dom-click-open.cjs gemini|willow "<selector>" [index=-1] [waitMs=900]
 */
const puppeteer = require('puppeteer-core');

const ORIGINS = { gemini: 'https://gemini.google.com', willow: 'http://localhost:3000' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const [which = 'gemini', selector, indexArg = '-1', waitArg = '900'] = process.argv.slice(2);
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith(ORIGINS[which]));
  if (!page) throw new Error(`no ${which} tab`);
  await page.bringToFront();
  const clicked = await page.evaluate((sel, idx) => {
    const all = [...document.querySelectorAll(sel)].filter((el) => el.getBoundingClientRect().width > 0);
    const el = all[idx < 0 ? all.length + idx : idx];
    if (!el) return `no visible ${sel}`;
    el.scrollIntoView({ block: 'center' });
    el.click();
    const r = el.getBoundingClientRect();
    return `clicked ${sel} #${all.indexOf(el)} at [${[r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10)}]`;
  }, selector, Number(indexArg));
  console.log(clicked);
  await sleep(Number(waitArg));
  const surfaces = await page.evaluate(() => {
    const r1 = (n) => Math.round(n * 10) / 10;
    const box = (el) => { const r = el.getBoundingClientRect(); return `[${[r.x, r.y, r.width, r.height].map(r1).join(',')}]`; };
    return [...document.querySelectorAll('gem-menu, .mat-mdc-menu-panel, mat-bottom-sheet-container, mat-dialog-container, [role="menu"], [role="dialog"], .gemini-bottom-sheet, .spark-task-detail__response-menu')]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => {
        const cs = getComputedStyle(el);
        const rows = [...el.querySelectorAll('gem-menu-item-content, gem-list-item .mat-mdc-list-item, [role="menuitem"], button')]
          .filter((row) => row.getBoundingClientRect().height > 0)
          .slice(0, 8)
          .map((row) => `    row ${box(row)} "${(row.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30)}"`);
        return `${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/).slice(0, 2).join('.')} ${box(el)} bg ${cs.backgroundColor} r ${cs.borderRadius} pad ${cs.padding}\n${rows.join('\n')}`;
      }).join('\n');
  });
  console.log(surfaces || 'no overlay surface visible');
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
