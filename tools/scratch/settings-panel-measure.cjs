/*
 * Opens the side drawer in the debug Chrome's Gemini or Willow tab, presses the
 * settings gear in its footer, and measures the panel that opens: its box, surface and
 * motion (sampled every frame while it opens), any backdrop, and every visible text
 * leaf and icon inside it with the row it sits in.
 *
 *   node tools/scratch/settings-panel-measure.cjs gemini|willow [label] [--keep-open]
 *
 * Writes %TEMP%\willow-emulator\settings-<app>-<label>.json and prints a digest.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const APPS = {
  gemini: {
    url: 'https://gemini.google.com/',
    drawer: ['bard-sidenav', 'mat-sidenav', 'side-navigation-v2'],
    open: ['button[data-test-id="side-nav-menu-button"]', 'button[aria-label="Main menu"]'],
    panel: ['.cdk-overlay-pane .mat-mdc-menu-panel', '.cdk-overlay-pane mat-bottom-sheet-container', '.cdk-overlay-pane [role="menu"]', '.cdk-overlay-pane [role="dialog"]', '.cdk-overlay-pane'],
    backdrop: ['.cdk-overlay-backdrop'],
  },
  willow: {
    url: 'http://localhost:3000/',
    drawer: ['.studio-sidebar'],
    open: ['.studio-sidebar-mobile-open'],
    panel: ['.willow-settings-sheet', '[role="menu"][aria-label="Settings"]'],
    backdrop: ['.willow-settings-sheet-backdrop'],
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function drawerOpen(cfg) {
  const root = cfg.drawer.map((s) => document.querySelector(s)).find((el) => el && el.getBoundingClientRect().width > 0);
  if (!root) return false;
  const r = root.getBoundingClientRect();
  return r.right > 40 && r.x > -20;
}

function click(selectors) {
  for (const s of selectors) {
    const el = [...document.querySelectorAll(s)].find((c) => c.getBoundingClientRect().width > 0);
    if (el) { el.click(); return s; }
  }
  return null;
}

/** Presses the gear and samples the panel on every frame for `ms`. */
async function pressGearAndSample(cfg, ms) {
  const root = cfg.drawer.map((s) => document.querySelector(s)).find((el) => el && el.getBoundingClientRect().width > 0);
  const gear = [...root.querySelectorAll('button')].find((b) => /settings/i.test(b.getAttribute('aria-label') || '') && b.getBoundingClientRect().width > 0);
  if (!gear) return { error: 'no gear' };
  const findPanel = () => {
    for (const s of cfg.panel) {
      const all = [...document.querySelectorAll(s)].filter((el) => el.getBoundingClientRect().width > 0);
      if (all.length) return all[all.length - 1];
    }
    return null;
  };
  const gearRect = gear.getBoundingClientRect();
  const frames = [];
  const t0 = performance.now();
  gear.click();
  await new Promise((resolve) => {
    const tick = () => {
      const t = performance.now() - t0;
      const panel = findPanel();
      if (panel) {
        const cs = getComputedStyle(panel);
        const r = panel.getBoundingClientRect();
        const pane = panel.closest('.cdk-overlay-pane');
        const pcs = pane ? getComputedStyle(pane) : null;
        frames.push({
          t: Math.round(t),
          rect: [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10),
          opacity: cs.opacity,
          transform: cs.transform,
          paneTransform: pcs ? pcs.transform : null,
          paneOpacity: pcs ? pcs.opacity : null,
        });
      } else {
        frames.push({ t: Math.round(t), panel: null });
      }
      if (t < ms) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
  return { gear: { label: gear.getAttribute('aria-label'), rect: [gearRect.x, gearRect.y, gearRect.width, gearRect.height] }, frames };
}

function measurePanel(cfg) {
  const round = (n) => Math.round(n * 100) / 100;
  const box = (r) => [r.x, r.y, r.width, r.height].map(round);
  let panel = null;
  for (const s of cfg.panel) {
    const all = [...document.querySelectorAll(s)].filter((el) => el.getBoundingClientRect().width > 0);
    if (all.length) { panel = all[all.length - 1]; break; }
  }
  if (!panel) return { error: 'no panel' };
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    for (let n = el; n && n !== panel.parentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  const rowOf = (el) => {
    const row = el.closest('[role="menuitem"], [role="menuitemradio"], button, a, li');
    if (!row || !panel.contains(row)) return null;
    const cs = getComputedStyle(row);
    return { tag: row.tagName.toLowerCase(), rect: box(row.getBoundingClientRect()), padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '), radius: cs.borderRadius, gap: cs.gap };
  };
  const items = [];
  const seen = new Set();
  const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
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
    items.push({ kind: icon ? 'icon' : 'text', text: text.slice(0, 48), rect: box(el.getBoundingClientRect()), glyphs: box(range.getBoundingClientRect()), font: cs.fontFamily.split(',')[0].replace(/"/g, ''), size: cs.fontSize, lineHeight: cs.lineHeight, weight: cs.fontWeight, axes: cs.fontVariationSettings, color: cs.color, row: rowOf(el) });
  }
  for (const el of panel.querySelectorAll('mat-icon, [data-mat-icon-name], .google-symbols, .luminous-symbols, .material-symbols-rounded, svg, img')) {
    if (seen.has(el) || !shown(el) || (el.tagName.toLowerCase() === 'svg' && el.parentElement?.closest('svg'))) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    items.push({ kind: el.tagName.toLowerCase() === 'svg' ? 'svg' : 'icon', text: el.getAttribute('data-mat-icon-name') || el.getAttribute('fonticon') || el.textContent.trim().slice(0, 30), rect: box(el.getBoundingClientRect()), size: cs.fontSize, axes: cs.fontVariationSettings, color: cs.color || cs.fill, fill: cs.fill, row: rowOf(el) });
  }
  items.sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0]);
  const cs = getComputedStyle(panel);
  const pane = panel.closest('.cdk-overlay-pane');
  let backdrop = null;
  for (const s of cfg.backdrop) {
    const el = [...document.querySelectorAll(s)].find((b) => b.getBoundingClientRect().width > 0);
    if (el) { const bcs = getComputedStyle(el); backdrop = { selector: s, rect: box(el.getBoundingClientRect()), bg: bcs.backgroundColor, opacity: bcs.opacity, cls: String(el.className).slice(0, 120) }; break; }
  }
  return {
    viewport: `${innerWidth}x${innerHeight}`,
    panel: {
      tag: panel.tagName.toLowerCase(),
      cls: String(panel.className).slice(0, 160),
      rect: box(panel.getBoundingClientRect()),
      bg: cs.backgroundColor,
      radius: cs.borderRadius,
      shadow: cs.boxShadow,
      padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
      maxHeight: cs.maxHeight,
      overflowY: cs.overflowY,
      transformOrigin: cs.transformOrigin,
      animation: `${cs.animationName} ${cs.animationDuration} ${cs.animationTimingFunction} ${cs.animationDelay}`,
      transition: cs.transition,
      pane: pane ? { rect: box(pane.getBoundingClientRect()), cls: String(pane.className).slice(0, 120) } : null,
      scroll: { scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight },
    },
    backdrop,
    items,
  };
}

(async () => {
  const args = process.argv.slice(2);
  const keepOpen = args.includes('--keep-open');
  const [name, label = 'run'] = args.filter((a) => !a.startsWith('--'));
  const cfg = APPS[name];
  if (!cfg) throw new Error('usage: settings-panel-measure.cjs gemini|willow [label] [--keep-open]');
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((candidate) => candidate.url().startsWith(cfg.url));
  await page.bringToFront();
  if (!(await page.evaluate(drawerOpen, cfg))) {
    if (!(await page.evaluate(click, cfg.open))) throw new Error('no drawer button');
    await sleep(900);
  }
  const motion = await page.evaluate(pressGearAndSample, cfg, 700);
  await sleep(300);
  const data = await page.evaluate(measurePanel, cfg);
  data.motion = motion;
  const dir = path.join(os.tmpdir(), 'willow-emulator');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `settings-${name}-${label}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 1));

  console.log(`== ${name} ${data.viewport}  (${file})`);
  console.log('gear  ', JSON.stringify(motion.gear));
  console.log('panel ', JSON.stringify(data.panel));
  console.log('backdrop', JSON.stringify(data.backdrop));
  const firstSeen = motion.frames.find((f) => f.rect);
  console.log('motion', JSON.stringify(motion.frames.filter((f, i, all) => i === 0 || JSON.stringify({ ...f, t: 0 }) !== JSON.stringify({ ...all[i - 1], t: 0 })).slice(0, 24)), firstSeen ? '' : '(panel never seen)');
  for (const item of data.items || []) {
    const where = item.rect.map((n) => String(Math.round(n * 10) / 10)).join(',');
    const row = item.row ? ` row[${item.row.tag} ${item.row.rect.map((n) => Math.round(n * 10) / 10).join(',')} pad ${item.row.padding} r ${item.row.radius}]` : '';
    if (item.kind === 'text') console.log(`TEXT [${where}] x${item.glyphs[0]} w${item.glyphs[2]} | ${item.size}/${item.lineHeight} w${item.weight} | ${item.axes} | ${item.color} | ${item.font} | "${item.text}"${row}`);
    else console.log(`${item.kind.toUpperCase()} [${where}] ${item.size || ''} | ${item.axes || ''} | ${item.color} | "${item.text}"${row}`);
  }
  if (!keepOpen) {
    await page.keyboard.press('Escape');
    await sleep(400);
  }
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
