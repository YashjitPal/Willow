/**
 * Opens a menu/popover in Gemini and Willow by clicking a trigger in each, prints the open
 * panel and its rows side by side, then closes both with Escape. Never selects an item.
 *
 *   node tools/scratch/menu-pair.cjs "<gemini trigger>" "<willow trigger>" ["<gemini panel>"] ["<willow panel>"]
 */
const puppeteer = require('puppeteer-core');

const [gTrigger, wTrigger, gPanelSel = '.cdk-overlay-pane .mat-mdc-menu-panel, .cdk-overlay-pane .mat-mdc-select-panel, .cdk-overlay-pane mat-card, .cdk-overlay-pane .mat-mdc-tooltip', wPanelSel = '.gems-menu, .gems-tips, [role="tooltip"]'] = process.argv.slice(2);

const dump = (panelSel) => {
  const panel = [...document.querySelectorAll(panelSel)].find((el) => el.getBoundingClientRect().width > 0);
  if (!panel) return 'no panel';
  const r1 = (n) => Math.round(n * 10) / 10;
  const box = (el) => { const r = el.getBoundingClientRect(); return `[${[r.x, r.y, r.width, r.height].map(r1)}]`; };
  const cs = getComputedStyle(panel);
  const lines = [`panel ${box(panel)} bg ${cs.backgroundColor} r ${cs.borderRadius} pad ${cs.padding} shadow ${cs.boxShadow.slice(0, 90)}`];
  const rows = panel.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"], button, a');
  for (const row of rows) {
    const rc = getComputedStyle(row);
    const icon = row.querySelector('mat-icon, .google-symbols, .luminous-symbols, .material-symbols-rounded, svg');
    const text = [...row.querySelectorAll('*')].find((el) => !el.children.length && el.textContent.trim() && !/symbols|mat-icon/.test(String(el.className)) && el.tagName !== 'MAT-ICON');
    const tc = text ? getComputedStyle(text) : null;
    const ic = icon ? getComputedStyle(icon) : null;
    lines.push(`  row ${box(row)} pad ${rc.padding} bg ${rc.backgroundColor} | icon ${icon ? `${box(icon)} ${ic.fontFamily.split(',')[0]} ${ic.fontSize} ${ic.color} ${icon.getAttribute('fonticon') || icon.textContent.trim()}` : '-'} | text ${text ? `${box(text)} ${tc.fontSize}/${tc.lineHeight} w${tc.fontWeight} ${tc.color} "${text.textContent.trim().slice(0, 40)}"` : '-'}`);
  }
  const extras = [...panel.querySelectorAll('*')].filter((el) => !el.children.length && el.textContent.trim() && !el.closest('[role="menuitem"],[role="menuitemradio"],[role="option"],button,a'));
  for (const el of extras.slice(0, 8)) {
    const c = getComputedStyle(el);
    lines.push(`  text ${box(el)} ${c.fontSize}/${c.lineHeight} w${c.fontWeight} ${c.color} "${el.textContent.trim().slice(0, 60)}"`);
  }
  return lines.join('\n');
};

async function open(page, trigger, panelSel) {
  await page.bringToFront();
  await page.evaluate((sel) => {
    const el = [...document.querySelectorAll(sel)].find((x) => x.getBoundingClientRect().width > 0);
    el.scrollIntoView({ block: 'nearest' });
  }, trigger);
  const el = await page.$(trigger);
  const r = await el.boundingBox();
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
  await new Promise((res) => setTimeout(res, 700));
  const out = await page.evaluate(dump, panelSel);
  await page.keyboard.press('Escape');
  await new Promise((res) => setTimeout(res, 400));
  return `trigger [${[r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10)}]\n${out}`;
}

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const pages = await browser.pages();
  const gemini = pages.find((p) => p.url().startsWith('https://gemini.google.com'));
  const willow = pages.find((p) => (p.url().startsWith('http://localhost:3000') && !p.url().includes('/media')));
  console.log('GEMINI', await open(gemini, gTrigger, gPanelSel));
  console.log('WILLOW', await open(willow, wTrigger, wPanelSel));
  browser.disconnect();
})();
