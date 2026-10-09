/**
 * Dumps the drawer's Notebooks section in Gemini or Willow relative to its header: the
 * header, then each row with its pill, icon, label (with type) and any visible menu
 * button. Read-only; the drawer must already be open.
 *
 *   node tools/scratch/drawer-section.cjs gemini|willow
 */
const puppeteer = require('puppeteer-core');

const ORIGINS = { gemini: 'https://gemini.google.com', willow: 'http://localhost:3000' };

(async () => {
  const [which = 'gemini'] = process.argv.slice(2);
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith(ORIGINS[which]));
  if (!page) throw new Error(`no ${which} tab`);
  const out = await page.evaluate((app) => {
    const r1 = (n) => Math.round(n * 10) / 10;
    const header = app === 'gemini'
      ? document.querySelector('expandable-section.expanded .expandable-section-header')
      : [...document.querySelectorAll('aside .sidebar-section-header')]
        .find((el) => el.textContent.includes('Notebooks'));
    if (!header) return ['no Notebooks header'];
    const top = header.getBoundingClientRect().y;
    const box = (el) => {
      const b = el.getBoundingClientRect();
      return `[${r1(b.x)},${r1(b.y - top)},${r1(b.width)},${r1(b.height)}]`;
    };
    const type = (el) => {
      const cs = getComputedStyle(el);
      return `${cs.fontSize}/${cs.lineHeight} w${cs.fontWeight} ${cs.color} fvs ${cs.fontVariationSettings}`;
    };
    const lines = [`header ${box(header)}`];
    const title = [...header.querySelectorAll('span')].find((s) => s.textContent.trim() === 'Notebooks');
    if (title) lines.push(`  title ${box(title)} ${type(title)}`);
    const toggle = header.querySelector('mat-icon, .luminous-symbols, .google-symbols');
    if (toggle) lines.push(`  toggle "${toggle.getAttribute('fonticon') || toggle.textContent.trim()}" ${box(toggle)} ${type(toggle)}`);

    const rows = app === 'gemini'
      ? [...header.closest('expandable-section').querySelectorAll('a.gem-nav-list-item')]
      : [...(header.nextElementSibling?.querySelectorAll('.sidebar-item-row') ?? [])];
    for (const row of rows) {
      const cs = getComputedStyle(row);
      const label = [...row.querySelectorAll('span')].reverse().find((s) => s.children.length === 0 && s.textContent.trim() && !/^[a-z_0-9]+$/.test(s.textContent.trim()))
        || [...row.querySelectorAll('span')].find((s) => s.children.length === 0 && s.textContent.trim().length > 3);
      const icon = row.querySelector('mat-icon, .luminous-symbols, .google-symbols');
      lines.push(`row ${box(row)} bg ${cs.backgroundColor} r ${cs.borderRadius} pad ${cs.padding}`);
      if (icon) lines.push(`  icon "${icon.getAttribute('fonticon') || icon.textContent.trim()}" ${box(icon)} ${type(icon)}`);
      if (label) lines.push(`  label "${label.textContent.trim()}" ${box(label)} ${type(label)}`);
      const host = app === 'gemini' ? row.closest('gem-nav-list-item') : row;
      const menu = host && [...host.querySelectorAll('button')].find((b) => b !== row && b.getBoundingClientRect().width > 0
        && getComputedStyle(b).visibility !== 'hidden' && getComputedStyle(b).opacity !== '0');
      if (menu) {
        const glyph = menu.querySelector('mat-icon, .luminous-symbols, .google-symbols');
        lines.push(`  menu ${box(menu)} op ${getComputedStyle(menu).opacity}${glyph ? ` glyph "${glyph.getAttribute('fonticon') || glyph.textContent.trim()}" ${box(glyph)} ${type(glyph)}` : ''}`);
      }
    }
    return lines;
  }, which);
  console.log(out.join('\n'));
  browser.disconnect();
})();
