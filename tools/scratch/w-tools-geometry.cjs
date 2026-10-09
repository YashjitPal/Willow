// Element-by-element geometry and style of the Tools pages, dumped from Flow and from Willow with
// the same selectors, then compared.
//   node tools/scratch/w-tools-geometry.cjs flow     Flow, in a tab of its own in the debug Chrome
//                                                    ([::1]:9222), view-only: it opens pages, tabs
//                                                    and a menu, and creates, renames or deletes nothing.
//   node tools/scratch/w-tools-geometry.cjs willow   Willow on :3101, in its own headless Chrome.
//   node tools/scratch/w-tools-geometry.cjs compare  Differences, per state and element.
// --only=state,state limits the states. Positions are relative to each state's root, since
// Willow's Media sidebar stands where Flow's project nav is.
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const MODE = process.argv[2];
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length).split(',').filter(Boolean);
const FLOW_BASE = 'https://flow.google.com/project/eb4308cd-f6c9-43e9-85fd-ea2acd8584c8';
const WILLOW = 'http://localhost:3101';
const ROOT = '/@fs/C:/Users/Yashjit%202/Workspace/Willow%20Code';
const PROJECT = 'wt-geo';
const out = (app) => path.join(__dirname, `../ui-research/captures/${app}/tools/geometry`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A component's host: a custom element in Flow, a class in Willow. */
const host = (name, inner = '') => ({ label: `<${name}>${inner ? ` ${inner}` : ''}`, flow: `flow-${name}${inner ? ` ${inner}` : ''}`, willow: `.ng-flow-${name}${inner ? ` ${inner}` : ''}` });
const either = (label, flow, willow) => ({ label, flow, willow });

const MANAGER = [
  '.applet-manager-header', '.applet-manager-header .header-title', '.marketplace-toggles', '.marketplace-toggles .mat-button-toggle-button',
  '.marketplace-toggles .toggle-text', '.applet-manager-content', '.applet-section', '.applet-section .section-title',
];
const CARDS = [
  host('applet-card'), '.applet-card-main', '.applet-preview-container', '.applet-gallery-footer', '.applet-tool-icon',
  '.applet-title-row', '.applet-name', '.applet-author', '.applet-description', '.applet-menu-button',
];
const STATES = [
  { name: 'my-tools', path: '/tools', tab: 'My Tools', root: '.applet-manager-page', selectors: [...MANAGER, '.create-applet-card', '.create-applet-thumbnail', '.create-applet-icon', '.create-applet-name', ...CARDS] },
  {
    name: 'templates', path: '/tools', tab: 'Templates', root: '.applet-manager-page',
    selectors: [...MANAGER, host('applet-hero-banner'), '.ng-flow-applet-hero-banner .banner, flow-applet-hero-banner .banner', '.hero-content', '.hero-title', '.hero-subtitle', '.hero-cta-button', ...CARDS],
  },
  {
    name: 'community', path: '/tools', tab: 'Community', root: '.applet-manager-page',
    selectors: [...MANAGER, '.community-carousel-banner', '.community-banner-top', '.community-banner-bottom', '.community-tool-thumbnail', '.community-tool-name', '.community-author-name', '.community-cta-button', '.community-carousel-indicators', '.carousel-indicator-progress', ...CARDS],
  },
  {
    name: 'create', path: '/create-tool', root: '.create-applet-page',
    selectors: ['.create-applet-header', '.create-applet-header .header-title', '.create-applet-content', '.create-applet-hero-title', '.hero-line', '.suggestions-row', '.suggestion-card', '.suggestion-icon', '.suggestion-image', '.suggestion-name', '.suggestion-subtitle', '.create-applet-prompt-box-wrapper', '.create-applet-prompt-box', '.prompt-top-row', '.bottom-controls', '.generate-icon-button', '.disclaimer-text'],
  },
  {
    name: 'tool-app', path: '/tool/{tool}?mode=APP', root: '.applet-view-page', settle: 6000,
    selectors: ['.applet-view-header', '.applet-icon-container', '.applet-view-toggles', '.applet-view-toggles .mat-button-toggle-button', '.applet-view-toggles .toggle-text', '.header-right', '.header-right button', '.apply-to-be-featured-button', '.applet-view-main-container', '.applet-view-content', '.iframe-container', '.applet-view-footer', '.footer-disclaimer-text', '.credits-info-icon'],
  },
  {
    name: 'tool-edit', path: '/tool/{tool}?mode=EDIT', root: '.applet-view-page', settle: 6000,
    selectors: ['.applet-view-header', '.applet-view-toggles .mat-button-toggle-button', '.applet-view-main-container', '.applet-content-container', '.applet-content-tab-bar', '.applet-content-tab', '.iframe-container', '.sidebar-wrapper', '.applet-chat-sidebar', '.applet-chat-sidebar .sidebar-header', '.applet-chat-sidebar .header-title', '.applet-chat-sidebar .header-actions button', '.sidebar-footer', '.applet-prompt-box', '.prompt-textarea', '.prompt-box-actions'],
  },
  {
    name: 'tool-code', path: '/tool/{tool}?mode=EDIT', root: '.applet-view-page', tabText: 'Code', settle: 6000,
    selectors: ['.applet-content-tab-bar', '.applet-content-tab', '.applet-code-explorer', '.file-item', '.file-item .file-name', '.code-line', '.line-number', '.line-content'],
  },
  {
    name: 'dialog-icon', path: '/tool/{tool}?mode=APP', root: '.applet-view-page', menuItem: 'Edit icon', settle: 4000,
    selectors: ['.mat-mdc-dialog-surface', '.dialog-header', '.dialog-title', '.dialog-body', '.preview-box', '.details-box', '.grid-container', '.upload-card', '.icon-card', '.mat-mdc-dialog-surface .action-button', '.mat-mdc-dialog-surface .action-button .mdc-button__label', '.mat-mdc-dialog-surface button[aria-label="Close dialog"], .mat-mdc-dialog-surface .dialog-header button'],
  },
  {
    name: 'dialog-description', path: '/tool/{tool}?mode=APP', root: '.applet-view-page', menuItem: 'Edit description', settle: 4000,
    selectors: ['.mat-mdc-dialog-surface', '.dialog-header', '.dialog-title', '.dialog-content', '.mat-mdc-dialog-surface textarea', '.dialog-actions', '.mat-mdc-dialog-surface .action-button', '.mat-mdc-dialog-surface .action-button .mdc-button__label'],
  },
  {
    name: 'tool-more', path: '/tool/{tool}?mode=APP', root: '.applet-view-page', more: true, settle: 5000,
    selectors: [either('menu panel', '.mat-mdc-menu-panel', '.sb-menu'), either('menu item', '.mat-mdc-menu-item', '.sb-menu .sb-menu-item'), either('menu label', '.mat-mdc-menu-item .mat-mdc-menu-item-text', '.sb-menu .sb-menu-item__label'), either('menu divider', '.mat-mdc-menu-panel .mat-divider', '.sb-menu .sb-menu-divider')],
  },
].filter((s) => !ONLY.length || ONLY.includes(s.name));

/** In the page: every match's box (relative to the root) and the styles that make it look as it does. */
function dump(entries, rootSel, max) {
  const root = rootSel && document.querySelector(rootSel);
  const rr = root ? root.getBoundingClientRect() : { x: 0, y: 0, width: innerWidth, height: innerHeight };
  const out = {};
  for (const { label, sel } of entries) {
    let els = [];
    try { els = [...document.querySelectorAll(sel)]; } catch { els = []; }
    out[label] = els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).slice(0, max).map((e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return {
        x: Math.round(r.x - rr.x), y: Math.round(r.y - rr.y), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
        font: `${s.fontWeight} ${s.fontSize}/${s.lineHeight} ${s.fontFamily.split(',')[0].replace(/["']/g, '')}`,
        ls: s.letterSpacing, color: s.color, bg: s.backgroundColor, radius: s.borderRadius, pad: s.padding, gap: s.gap,
        border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`, text: (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40),
        cls: typeof e.className === 'string' ? e.className.split(/\s+/).filter((c) => c && !c.startsWith('_ng')).slice(0, 8).join(' ') : '',
        disabled: !!e.disabled,
        anim: s.animationName === 'none' ? 'none' : `${s.animationName} ${s.animationDuration} ${s.animationTimingFunction} ${s.animationIterationCount}`,
        trans: s.transitionDuration === '0s' ? 'none' : `${s.transitionProperty} ${s.transitionDuration} ${s.transitionTimingFunction}`,
      };
    });
  }
  return { root: { x: Math.round(rr.x), y: Math.round(rr.y), w: Math.round(rr.width), h: Math.round(rr.height) }, viewport: [innerWidth, innerHeight, devicePixelRatio], out };
}

const entriesFor = (state, app) => state.selectors.map((s) => (typeof s === 'string' ? { label: s, sel: s } : { label: s.label, sel: s[app] }));

async function capture(app, page, urlFor) {
  fs.mkdirSync(out(app), { recursive: true });
  const waitFor = async (fn, arg, ms = 30000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await page.evaluate(`!!((${fn})(${JSON.stringify(arg ?? null)}))`).catch(() => false)) return true;
      await sleep(200);
    }
    return false;
  };
  const clickText = (sel, text) => page.evaluate((s, t) => {
    const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim() === t);
    el?.click();
    return !!el;
  }, sel, text);
  for (const state of STATES) {
    await page.goto(urlFor(state.path), { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
    const up = await waitFor((sel) => document.querySelector(sel), state.root, 90000);
    if (state.tab) {
      await waitFor(() => document.querySelectorAll('.marketplace-toggles .mat-button-toggle-button').length >= 3, null, 30000);
      await clickText('.marketplace-toggles .mat-button-toggle-button', state.tab);
      await waitFor(() => document.querySelector('.applet-section'), null, 30000);
    }
    const activeTab = () => page.evaluate(() => document.querySelector('.applet-content-tab-active, .applet-content-tab[aria-selected="true"]')?.textContent.trim() ?? null).catch(() => null);
    if (state.tabText) {
      await waitFor(() => document.querySelectorAll('.applet-content-tab').length >= 2, null, 30000);
      await clickText('.applet-content-tab', state.tabText);
    }
    await sleep(state.settle ?? 2500);
    if (state.tabText && (await activeTab()) !== state.tabText) console.log(`${app} ${state.name}: ${state.tabText} is not the active tab at the dump (${await activeTab()})`);
    if (state.more || state.menuItem) {
      await page.evaluate(() => document.querySelector('.applet-view-header button[aria-label="More options"]')?.click());
      await sleep(800);
    }
    if (state.menuItem) {
      // Opens the dialog only; it is closed with Escape below, so nothing is saved.
      const opened = await page.evaluate((label) => {
        const row = [...document.querySelectorAll('.mat-mdc-menu-item, .sb-menu .sb-menu-item')].find((e) => e.textContent.trim().endsWith(label));
        row?.click();
        return !!row;
      }, state.menuItem);
      await waitFor(() => document.querySelector('.mat-mdc-dialog-surface'), null, 10000);
      console.log(`${app} ${state.name}: opened "${state.menuItem}" (${opened})`);
    }
    // A tab not in front runs no frames, so a menu stays on its first, scaled-down frame and a
    // transition on its start value. Jump every running animation to its end before reading.
    await page.evaluate(() => { for (const a of document.getAnimations()) { try { a.finish(); } catch { /* an infinite one keeps running */ } } }).catch(() => {});
    const result = await page.evaluate(dump, entriesFor(state, app), state.root, 12).catch((e) => ({ error: String(e.message || e) }));
    // Every visible leaf with text under the headers and the suggestions, keyed by that text (icons
    // included, by their ligature): what each word and glyph looks like, wherever its box sits.
    result.texts = await page.evaluate((scopes, rootSel) => {
      const root = document.querySelector(rootSel)?.getBoundingClientRect() ?? { x: 0, y: 0 };
      const out = {};
      for (const scope of scopes) {
        for (const host of document.querySelectorAll(scope)) {
          for (const el of host.querySelectorAll('*')) {
            if (el.children.length) continue;
            const text = (el.innerText || '').trim().replace(/\s+/g, ' ');
            const r = el.getBoundingClientRect();
            if (!text || !r.width || !r.height) continue;
            const key = `${scope} | ${text.slice(0, 40)}`;
            if (out[key]) continue;
            const s = getComputedStyle(el);
            out[key] = { x: Math.round(r.x - root.x), y: Math.round(r.y - root.y), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, color: s.color, font: `${s.fontWeight} ${s.fontSize}/${s.lineHeight} ${s.fontFamily.split(',')[0].replace(/["']/g, '')}`, ls: s.letterSpacing, opacity: s.opacity };
          }
        }
      }
      return out;
    }, ['.applet-manager-header', '.create-applet-header', '.applet-view-header', '.suggestions-row', '.applet-chat-sidebar .sidebar-header', '.applet-content-tab-bar', '.applet-view-footer', '.disclaimer-text'], state.root).catch(() => ({}));
    // The boxes stacked under a point in the nav and one in the content: where the column edges come from.
    result.chains = await page.evaluate((points) => points.map(([x, y]) => {
      const chain = [];
      for (let el = document.elementFromPoint(x, y); el && el !== document.documentElement; el = el.parentElement) {
        const r = el.getBoundingClientRect();
        const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.') : '';
        chain.push(`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} [${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}]`);
      }
      return { at: [x, y], chain };
    }), [[100, 300], [700, 120]]).catch(() => []);
    fs.writeFileSync(path.join(out(app), `${state.name}.json`), JSON.stringify({ app, state: state.name, url: page.url(), up, ...result }, null, 1));
    // A tab in the debug Chrome that is not in front paints no frames, so its screenshot never
    // comes back; the layout above is read regardless. Skipped rather than bringing the tab forward.
    const shot = await Promise.race([page.screenshot({ path: path.join(out(app), `${state.name}.png`) }).then(() => true, () => false), sleep(10000).then(() => false)]);
    if (!shot) console.log(`${app} ${state.name}: no screenshot (the tab is not painting)`);
    if (state.more || state.menuItem) {
      await page.keyboard.press('Escape');
      await sleep(600);
      const still = await page.evaluate(() => !!document.querySelector('.mat-mdc-dialog-surface, .mat-mdc-menu-panel, .sb-menu')).catch(() => false);
      if (still) { await page.keyboard.press('Escape'); await sleep(400); }
    }
    const found = result.out ? Object.values(result.out).filter((v) => v.length).length : 0;
    console.log(`${app} ${state.name.padEnd(10)} ${up ? 'up' : 'ROOT MISSING'}  ${found}/${state.selectors.length} selectors found  ${page.url().slice(0, 100)}`);
  }
}

async function flow() {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1536, height: 826, deviceScaleFactor: 1.25 });
    // The tool pages show the account's own first tool, opened from its card (only opened, never edited).
    await page.goto(`${FLOW_BASE}/tools`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('.marketplace-toggles .mat-button-toggle-button', { timeout: 90000 });
    await page.evaluate(() => [...document.querySelectorAll('.marketplace-toggles .mat-button-toggle-button')].find((b) => b.textContent.trim() === 'My Tools')?.click());
    await page.waitForSelector('flow-applet-card .applet-card-main', { timeout: 30000 });
    await page.evaluate(() => document.querySelector('flow-applet-card .applet-card-main').click());
    await page.waitForFunction(() => /\/tool\/[^/?]+/.test(location.pathname), { timeout: 30000 });
    const tool = page.url().match(/\/tool\/([^/?]+)/)[1];
    console.log(`flow tool ${tool}`);
    await capture('flow', page, (p) => `${FLOW_BASE}${p.replace('{tool}', tool)}`);
  } finally {
    await page.close().catch(() => {});
    browser.disconnect();
  }
}

async function willow() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-tools-geo-'));
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true, userDataDir,
    defaultViewport: { width: 1536, height: 826, deviceScaleFactor: 1.25 },
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
    protocolTimeout: 300000,
  });
  const page = (await browser.pages())[0];
  await page.evaluateOnNewDocument(() => { if (window.top === window) performance.setResourceTimingBufferSize(100000); });
  page.on('pageerror', (e) => console.log(`willow pageerror: ${String(e.message || e).slice(0, 400)}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/stroke-width|tailwindcss' violates/.test(m.text())) console.log(`willow console.error: ${m.text().slice(0, 400)}`); });
  try {
    await page.goto(`${WILLOW}/media`, { waitUntil: 'networkidle2', timeout: 180000 }).catch(() => {});
    await sleep(1500);
    await page.evaluate(async (root, project) => {
      const reg = await import(`${root}/platform/projects/src/registry.ts`);
      reg.writeProjectRegistry([...reg.readProjectRegistry().filter((e) => e.id !== project), { id: project, name: 'Geometry', kind: 'media' }]);
    }, ROOT, PROJECT);
    // A tool to open: the first template, as a copy (in this throwaway profile only).
    await page.goto(`${WILLOW}/media/tools?projectId=${PROJECT}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.marketplace-toggles .mat-button-toggle-button', { timeout: 120000 });
    await page.evaluate(() => [...document.querySelectorAll('.marketplace-toggles .mat-button-toggle-button')].find((b) => b.textContent.trim() === 'Templates')?.click());
    await page.waitForSelector('.applet-grid-gallery .applet-card-main', { timeout: 30000 });
    await page.evaluate(() => document.querySelector('.applet-grid-gallery .applet-card-main').click());
    // The template's address first, then its copy's: template ids are UUIDs too, so wait for the copy's page.
    await page.waitForFunction(() => /^Remix of /.test(document.querySelector('.applet-view-header .editable-text-input')?.value || ''), { timeout: 30000 });
    const tool = page.url().match(/\/media\/tool\/([^?]+)/)[1];
    await sleep(3000);
    await capture('willow', page, (p) => {
      const local = `${WILLOW}/media${p.replace('{tool}', tool)}`;
      return `${local}${local.includes('?') ? '&' : '?'}projectId=${PROJECT}`;
    });
  } finally {
    await browser.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

function compare() {
  const styleKeys = ['font', 'ls', 'color', 'bg', 'radius', 'pad', 'gap', 'border', 'anim', 'trans'];
  let total = 0;
  for (const state of STATES) {
    const read = (app) => { try { return JSON.parse(fs.readFileSync(path.join(out(app), `${state.name}.json`), 'utf8')); } catch { return null; } };
    const f = read('flow');
    const w = read('willow');
    if (!f?.out || !w?.out) { console.log(`\n## ${state.name}: missing ${!f?.out ? 'flow' : ''} ${!w?.out ? 'willow' : ''}`); continue; }
    const lines = [];
    for (const { label } of entriesFor(state, 'flow')) {
      const a = f.out[label] ?? [];
      const b = w.out[label] ?? [];
      if (!a.length && !b.length) continue;
      if (!a.length || !b.length) { lines.push(`  ${label}: ${a.length ? 'missing in Willow' : 'only in Willow'} (${a.length} vs ${b.length})`); continue; }
      const notes = [];
      if (a.length !== b.length) notes.push(`count ${a.length} vs ${b.length}`);
      for (let i = 0; i < Math.min(a.length, b.length, 4); i++) {
        const p = a[i];
        const q = b[i];
        const diffs = [];
        if (Math.abs(p.w - q.w) > 1 || Math.abs(p.h - q.h) > 1) diffs.push(`size ${p.w}x${p.h} vs ${q.w}x${q.h}`);
        if (Math.abs(p.x - q.x) > 2 || Math.abs(p.y - q.y) > 2) diffs.push(`at ${p.x},${p.y} vs ${q.x},${q.y}`);
        for (const k of styleKeys) {
          if (p[k] === q[k]) continue;
          // An invisible border (Tailwind's reset gives every element a 0px solid one), and Flow's
          // 1px borders, which Chrome floors to one device pixel (0.8px at a 1.25 scale).
          if (k === 'border' && (/^0px/.test(p[k]) && /^0px/.test(q[k]) || p[k].replace(/^0\.8px/, '1px') === q[k])) continue;
          diffs.push(`${k} "${p[k]}" vs "${q[k]}"`);
        }
        if (diffs.length) notes.push(`[${i}${p.text ? ` "${p.text.slice(0, 18)}"` : ''}] ${diffs.join('; ')}`);
      }
      if (notes.length) lines.push(`  ${label}: ${notes.join(' | ')}`);
    }
    // By text: color, font, letter spacing and opacity of each word or glyph found in both.
    for (const [key, p] of Object.entries(f.texts ?? {})) {
      const q = w.texts?.[key];
      if (!q) continue;
      const diffs = ['color', 'font', 'ls', 'opacity'].filter((k) => p[k] !== q[k]).map((k) => `${k} "${p[k]}" vs "${q[k]}"`);
      if (Math.abs(p.h - q.h) > 1) diffs.push(`height ${p.h} vs ${q.h}`);
      if (diffs.length) lines.push(`  text ${key}: ${diffs.join('; ')}`);
    }
    total += lines.length;
    console.log(`\n## ${state.name}  (root flow ${JSON.stringify(f.root)} willow ${JSON.stringify(w.root)})${lines.length ? '' : '  same'}`);
    for (const line of lines) console.log(line);
  }
  console.log(`\n${total} elements differ`);
}

(MODE === 'flow' ? flow() : MODE === 'willow' ? willow() : MODE === 'compare' ? Promise.resolve(compare()) : Promise.reject(new Error('mode: flow | willow | compare')))
  .catch((e) => { console.error('FAILED:', e.stack || e.message); process.exitCode = 1; });
