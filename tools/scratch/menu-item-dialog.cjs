/**
 * Clicks the open menu's item whose label matches, then reports the dialog it raises:
 * the surface (box, fill, radius, padding, shadow), the backdrop, and every visible text,
 * field and button inside with box and type. Only for items that OPEN a dialog — never an
 * item that acts (Unpin, Remove...). Close it afterwards with press-key.cjs.
 *
 *   node tools/scratch/menu-item-dialog.cjs gemini|willow "<label>" [waitMs=900]
 */
const puppeteer = require('puppeteer-core');

const ORIGINS = { gemini: 'https://gemini.google.com', willow: 'http://localhost:3000' };
const REFUSE = /^(unpin|pin|remove from notebook)$/i;

(async () => {
  const [which = 'gemini', label, waitArg = '900'] = process.argv.slice(2);
  if (REFUSE.test(label || '')) throw new Error(`refusing to click "${label}" — it acts rather than opens`);
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith(ORIGINS[which]));
  await page.bringToFront();
  const clicked = await page.evaluate((text) => {
    const items = [...document.querySelectorAll('[role="menuitem"], gem-menu-item, .nb-menu-item')]
      .filter((el) => el.getBoundingClientRect().width > 0 && el.textContent.replace(/\s+/g, ' ').trim().endsWith(text));
    const item = items[0];
    if (!item) return `no menu item "${text}"`;
    item.click();
    return `clicked "${item.textContent.replace(/\s+/g, ' ').trim()}"`;
  }, label);
  console.log(clicked);
  await new Promise((resolve) => setTimeout(resolve, Number(waitArg)));
  const out = await page.evaluate(() => {
    const r1 = (n) => Math.round(n * 10) / 10;
    const box = (el) => { const r = el.getBoundingClientRect(); return `[${[r.x, r.y, r.width, r.height].map(r1).join(',')}]`; };
    const surface = [...document.querySelectorAll('.mat-mdc-dialog-surface, mat-dialog-container, [role="dialog"], .gemini-dialog, .nb-sheet')]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0];
    if (!surface) return 'no dialog';
    const cs = getComputedStyle(surface);
    const lines = [`surface <${surface.tagName.toLowerCase()}.${String(surface.className).split(/\s+/).slice(0, 2).join('.')}> ${box(surface)} bg ${cs.backgroundColor} r ${cs.borderRadius} pad ${cs.padding} shadow ${cs.boxShadow}`];
    const backdrop = [...document.querySelectorAll('.cdk-overlay-backdrop, [class*="backdrop"], [class*="scrim"]')].find((el) => el.getBoundingClientRect().width > 0);
    if (backdrop) lines.push(`backdrop ${box(backdrop)} bg ${getComputedStyle(backdrop).backgroundColor}`);
    const seen = new Set();
    for (const el of surface.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const ecs = getComputedStyle(el);
      if (ecs.visibility === 'hidden' || ecs.opacity === '0') continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
      const isControl = /^(BUTTON|INPUT|TEXTAREA)$/.test(el.tagName) || el.getAttribute('role') === 'switch';
      if (!own && !isControl) continue;
      const key = `${el.tagName}${box(el)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`  <${el.tagName.toLowerCase()}> ${box(el)} ${ecs.fontSize}/${ecs.lineHeight} w${ecs.fontWeight} ${ecs.color}${ecs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? ` bg ${ecs.backgroundColor}` : ''}${ecs.borderRadius !== '0px' ? ` r ${ecs.borderRadius}` : ''} pad ${ecs.padding}${own ? ` "${own.slice(0, 60)}"` : ''}${el.placeholder ? ` ph "${el.placeholder}"` : ''}`);
    }
    return lines.join('\n');
  });
  console.log(out);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
