/**
 * Clicks an element's centre with a real mouse event (for triggers a DOM click does not
 * reach), waits, then lists every open CDK overlay pane / portal surface with its box and
 * text. Only for controls that OPEN something. Close it afterwards with press-key.cjs.
 *
 *   node tools/scratch/mouse-click.cjs gemini|willow "<selector>" [index=0] [waitMs=900] [--hover]
 *
 * --hover moves the mouse there without clicking (for tooltips and hover states).
 */
const puppeteer = require('puppeteer-core');

const ORIGINS = { gemini: 'https://gemini.google.com', willow: 'http://localhost:3000' };

(async () => {
  const args = process.argv.slice(2);
  const hoverOnly = args.includes('--hover');
  const [which = 'gemini', selector, indexArg = '0', waitArg = '900'] = args.filter((a) => !a.startsWith('--'));
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith(ORIGINS[which]));
  if (!page) throw new Error(`no ${which} tab`);
  await page.bringToFront();
  const handles = await page.$$(selector);
  const visible = [];
  for (const handle of handles) {
    const box = await handle.boundingBox();
    if (box && box.width > 0 && box.height > 0) visible.push({ handle, box });
  }
  const index = Number(indexArg);
  const target = visible[index < 0 ? visible.length + index : index];
  if (!target) { console.log(`no visible ${selector} #${indexArg} (${visible.length} visible)`); browser.disconnect(); return; }
  await target.handle.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = await target.handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  if (!hoverOnly) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await new Promise((r) => setTimeout(r, Number(waitArg)));
  console.log(`${hoverOnly ? 'hovered' : 'clicked'} ${selector} #${index} at [${[box.x, box.y, box.width, box.height].map((n) => Math.round(n * 10) / 10)}]`);
  const panes = await page.evaluate(() => {
    const r1 = (n) => Math.round(n * 10) / 10;
    const out = [];
    for (const pane of document.querySelectorAll('.cdk-overlay-pane, [role="menu"], [role="dialog"], [role="tooltip"]')) {
      const r = pane.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      out.push(`${pane.tagName.toLowerCase()}.${String(pane.className).split(' ').slice(0, 3).join('.')} [${[r.x, r.y, r.width, r.height].map(r1)}] "${pane.innerText.replace(/\s+/g, ' ').trim().slice(0, 140)}"`);
    }
    return out;
  });
  console.log(panes.join('\n') || '(no overlay panes)');
  browser.disconnect();
})();
