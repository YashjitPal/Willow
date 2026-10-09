/*
 * Opens the side drawer in the debug Chrome's Gemini or Willow tab and measures every
 * visible text leaf and icon in it: the glyph box, the type (size, line-height, weight,
 * variation axes, colour) and the row each one sits in.
 *
 *   node tools/scratch/sidebar-measure.cjs gemini|willow [label] [--close]
 *
 * Writes %TEMP%\willow-emulator\sidebar-<app>-<label>.json and prints a digest sorted
 * top to bottom. `--close` shuts the drawer again afterwards.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const APPS = {
  gemini: {
    url: 'https://gemini.google.com/',
    root: ['bard-sidenav', 'mat-sidenav', 'side-navigation-v2', '[role="navigation"]'],
    open: ['button[data-test-id="side-nav-menu-button"]', 'button[aria-label="Main menu"]', 'button[aria-label*="menu" i]'],
    scrim: ['.mat-drawer-backdrop', '.mat-sidenav-backdrop', '.cdk-overlay-backdrop'],
  },
  willow: {
    url: 'http://localhost:3000/',
    root: ['.studio-sidebar'],
    open: ['.studio-sidebar-mobile-open'],
    scrim: ['.studio-sidebar-mobile-scrim'],
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function drawerState(cfg) {
  const root = cfg.root.map((s) => document.querySelector(s)).find((el) => el && el.getBoundingClientRect().width > 0);
  if (!root) return { found: false };
  const r = root.getBoundingClientRect();
  return { found: true, open: r.right > 40 && r.x > -20, rect: [r.x, r.y, r.width, r.height] };
}

function clickFirst(selectors) {
  for (const s of selectors) {
    const el = [...document.querySelectorAll(s)].find((c) => c.getBoundingClientRect().width > 0);
    if (el) {
      el.click();
      return s;
    }
  }
  return null;
}

function measure(cfg) {
  const round = (n) => Math.round(n * 100) / 100;
  const box = (r) => [r.x, r.y, r.width, r.height].map(round);
  const root = cfg.root.map((s) => document.querySelector(s)).find((el) => el && el.getBoundingClientRect().width > 0);
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    for (let n = el; n && n !== root.parentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  };
  const rowOf = (el) => {
    const row = el.closest('a, button, [role="button"], [role="menuitem"], [role="option"], [role="tab"], li, mat-list-item, side-nav-action-button');
    if (!row || !root.contains(row)) return null;
    const cs = getComputedStyle(row);
    return {
      tag: row.tagName.toLowerCase(),
      label: row.getAttribute('aria-label'),
      rect: box(row.getBoundingClientRect()),
      padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
      radius: cs.borderRadius,
      bg: cs.backgroundColor,
    };
  };

  const items = [];
  const seen = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el || seen.has(el) || !shown(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    const cls = String(el.className?.baseVal ?? el.className ?? '');
    const icon = el.tagName === 'MAT-ICON' || /symbols|material-icons|mat-icon/i.test(cls) || /Symbols|Material Icons/i.test(cs.fontFamily);
    const range = document.createRange();
    range.selectNodeContents(node);
    items.push({
      kind: icon ? 'icon' : 'text',
      text: text.slice(0, 48),
      tag: el.tagName.toLowerCase(),
      cls: cls.slice(0, 90),
      rect: box(el.getBoundingClientRect()),
      glyphs: box(range.getBoundingClientRect()),
      font: cs.fontFamily.split(',')[0].replace(/"/g, ''),
      size: cs.fontSize,
      lineHeight: cs.lineHeight,
      weight: cs.fontWeight,
      axes: cs.fontVariationSettings,
      opsz: cs.fontOpticalSizing,
      spacing: cs.letterSpacing,
      color: cs.color,
      row: rowOf(el),
    });
  }
  // Gemini's mat-icons draw their ligature from the `fonticon` attribute, so they have no text node.
  for (const el of root.querySelectorAll('mat-icon, [data-mat-icon-name], .google-symbols, .luminous-symbols, .material-symbols-rounded')) {
    if (seen.has(el) || !shown(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    items.push({
      kind: 'icon',
      text: el.getAttribute('data-mat-icon-name') || el.getAttribute('fonticon') || el.textContent.trim().slice(0, 30),
      tag: el.tagName.toLowerCase(),
      cls: String(el.className?.baseVal ?? el.className ?? '').slice(0, 90),
      rect: box(el.getBoundingClientRect()),
      glyphs: box(el.getBoundingClientRect()),
      font: cs.fontFamily.split(',')[0].replace(/"/g, ''),
      size: cs.fontSize,
      lineHeight: cs.lineHeight,
      weight: cs.fontWeight,
      axes: cs.fontVariationSettings,
      color: cs.color,
      row: rowOf(el),
    });
  }
  for (const svg of root.querySelectorAll('svg, img')) {
    if (!shown(svg) || (svg.tagName.toLowerCase() === 'svg' && svg.parentElement?.closest('svg'))) continue;
    items.push({ kind: svg.tagName.toLowerCase(), text: svg.getAttribute('aria-label') || svg.getAttribute('alt') || '', rect: box(svg.getBoundingClientRect()), color: getComputedStyle(svg).color, row: rowOf(svg) });
  }
  items.sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0]);
  const rs = getComputedStyle(root);
  return {
    viewport: `${innerWidth}x${innerHeight}`,
    root: { rect: box(root.getBoundingClientRect()), bg: rs.backgroundColor, radius: rs.borderRadius, shadow: rs.boxShadow, axes: rs.fontVariationSettings },
    items,
  };
}

(async () => {
  const args = process.argv.slice(2);
  const close = args.includes('--close');
  const [name, label = 'run'] = args.filter((a) => !a.startsWith('--'));
  const cfg = APPS[name];
  if (!cfg) throw new Error('usage: sidebar-measure.cjs gemini|willow [label] [--close]');
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((candidate) => candidate.url().startsWith(cfg.url));
  await page.bringToFront();

  let state = await page.evaluate(drawerState, cfg);
  if (!state.open) {
    const clicked = await page.evaluate(clickFirst, cfg.open);
    if (!clicked) throw new Error(`no drawer button found in ${name}`);
    await sleep(900);
    state = await page.evaluate(drawerState, cfg);
  }
  if (!state.open) throw new Error(`${name} drawer did not open: ${JSON.stringify(state)}`);

  const data = await page.evaluate(measure, cfg);
  const dir = path.join(os.tmpdir(), 'willow-emulator');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `sidebar-${name}-${label}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 1));

  console.log(`== ${name} ${data.viewport}  root ${JSON.stringify(data.root)}  (${file})`);
  for (const item of data.items) {
    const where = item.rect.map((n) => String(Math.round(n * 10) / 10)).join(',');
    if (item.kind === 'text' || item.kind === 'icon') {
      const row = item.row ? ` row[${item.row.tag} ${item.row.rect.map((n) => Math.round(n * 10) / 10).join(',')} pad ${item.row.padding} r ${item.row.radius}${item.row.bg !== 'rgba(0, 0, 0, 0)' ? ` bg ${item.row.bg}` : ''}]` : '';
      console.log(`${item.kind === 'icon' ? 'ICON' : 'TEXT'} [${where}] glyphs x${item.glyphs[0]} w${item.glyphs[2]} | ${item.size}/${item.lineHeight} w${item.weight} | ${item.axes} | ${item.color} | ${item.font} | "${item.text}"${row}`);
    } else {
      console.log(`${item.kind.toUpperCase()} [${where}] "${item.text}" ${item.color}`);
    }
  }

  if (close) {
    await page.keyboard.press('Escape');
    await sleep(500);
    if ((await page.evaluate(drawerState, cfg)).open) {
      await page.evaluate(clickFirst, cfg.scrim);
      await sleep(600);
    }
  }
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
