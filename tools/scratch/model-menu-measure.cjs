/*
 * Opens the header model picker's menu in the debug Chrome's Gemini and Willow tabs and
 * prints the panel, every row, and every row's parts with their boxes and type. For
 * Willow it also opens the Thinking Effort submenu. Leaves both menus closed.
 *
 *   node tools/scratch/model-menu-measure.cjs [gemini|willow] [full]
 *
 * "full" prints the whole subtree of every row instead of the first two rows.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const SCALE = Number(process.env.EMULATION_SCALE || 0.978);
const TABS = {
  gemini: {
    url: 'https://gemini.google.com/',
    trigger: 'button[aria-label^="Open mode picker"]',
    panel: '.cdk-overlay-pane gem-menu[role="menu"]',
    rows: 'gem-menu-item',
    separator: 'mat-divider, .mat-divider, [role="separator"], hr, gem-divider, .divider',
  },
  willow: {
    url: 'http://localhost:3000/',
    trigger: 'button.studio-mobile-model-button',
    panel: '[role="menu"][aria-label="Choose a model"]',
    rows: ':scope > div [role="menuitem"], :scope > div > div > [role="menuitem"]',
    separator: '[role="separator"]',
    submenuTrigger: '[aria-haspopup="menu"]',
    submenu: '[role="menu"][aria-label="Thinking Effort"]',
    submenuRows: '[role="menuitemradio"]',
  },
};
const PROPS = [
  'display', 'boxSizing', 'width', 'height', 'minHeight', 'maxHeight', 'minWidth', 'maxWidth', 'padding',
  'margin', 'gap', 'borderRadius', 'backgroundColor', 'boxShadow', 'border', 'overflow', 'fontFamily',
  'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'fontVariationSettings', 'color', 'opacity',
  'transform', 'alignItems', 'justifyContent', 'textOverflow', 'whiteSpace', 'content',
];
const DEFAULTS = {
  padding: '0px', margin: '0px', gap: 'normal', borderRadius: '0px', backgroundColor: 'rgba(0, 0, 0, 0)',
  boxShadow: 'none', opacity: '1', transform: 'none', overflow: 'visible', minHeight: '0px', maxHeight: 'none',
  minWidth: '0px', maxWidth: 'none', alignItems: 'normal', justifyContent: 'normal', textOverflow: 'clip',
  whiteSpace: 'normal', content: 'normal', boxSizing: 'content-box',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function describe(rootSelector, rowSelector, separatorSelector, props, full, DEFAULTS) {
  const root = document.querySelector(rootSelector);
  if (!root) return null;
  const inherited = new Set(['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'fontVariationSettings', 'color', 'whiteSpace']);
  const lines = [];
  const read = (el, pseudo) => {
    const style = getComputedStyle(el, pseudo);
    return Object.fromEntries(props.map((key) => [key, style[key]]));
  };
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height].map((n) => +n.toFixed(2));
  };
  const label = (el) => {
    const cls = String(el.className?.baseVal ?? el.className).trim().split(/\s+/).filter(Boolean)
      .filter((c) => !/^ng-|^_ng|^mat-mdc-focus|^cdk-/.test(c)).slice(0, 4).join('.');
    const text = el.children.length ? '' : (el.textContent || '').trim().slice(0, 32);
    return `<${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}>${text ? ` "${text}"` : ''}`;
  };
  const visit = (el, depth, parentStyle) => {
    if (el.getBoundingClientRect().width === 0 && el.getBoundingClientRect().height === 0 && !el.children.length) return;
    const style = read(el);
    const shown = Object.entries(style).filter(([key, value]) => value !== undefined && value !== DEFAULTS[key]
      && !(inherited.has(key) && parentStyle && parentStyle[key] === value)
      && !(key === 'width' || key === 'height'));
    const pseudo = ['::before', '::after'].map((which) => {
      const ps = read(el, which);
      if (!ps.content || ps.content === 'none' || ps.content === 'normal') return null;
      return `${which}{${Object.entries(ps).filter(([k, v]) => v !== DEFAULTS[k] && !inherited.has(k)).map(([k, v]) => `${k}=${v}`).join(' | ')}}`;
    }).filter(Boolean);
    lines.push(`${'  '.repeat(depth)}${label(el)} rect=${JSON.stringify(box(el))}`);
    if (shown.length) lines.push(`${'  '.repeat(depth)}    ${shown.map(([k, v]) => `${k}=${v}`).join(' | ')}`);
    pseudo.forEach((p) => lines.push(`${'  '.repeat(depth)}    ${p}`));
    [...el.children].forEach((child) => visit(child, depth + 1, style));
  };

  lines.push(`PANEL ${label(root)} rect=${JSON.stringify(box(root))}`);
  const panelStyle = read(root);
  lines.push(`    ${Object.entries(panelStyle).filter(([k, v]) => v !== DEFAULTS[k]).map(([k, v]) => `${k}=${v}`).join(' | ')}`);
  let ancestor = root.parentElement;
  for (let i = 0; i < 3 && ancestor; i++, ancestor = ancestor.parentElement) {
    const s = getComputedStyle(ancestor);
    const chrome = { boxShadow: s.boxShadow, backgroundColor: s.backgroundColor, borderRadius: s.borderRadius, overflow: s.overflow,
      animation: s.animationName !== 'none' ? `${s.animationName} ${s.animationDuration} ${s.animationTimingFunction}` : 'none',
      transition: s.transitionDuration !== '0s' ? `${s.transitionProperty} ${s.transitionDuration} ${s.transitionTimingFunction}` : 'none',
      transformOrigin: s.transformOrigin, transform: s.transform, opacity: s.opacity };
    lines.push(`  parent${i + 1} ${label(ancestor)} rect=${JSON.stringify(box(ancestor))}`);
    lines.push(`      ${Object.entries(chrome).filter(([k, v]) => v !== DEFAULTS[k] && v !== 'none').map(([k, v]) => `${k}=${v}`).join(' | ')}`);
  }
  const rootStyle = getComputedStyle(root);
  lines.push(`  panel motion: animation=${rootStyle.animationName} ${rootStyle.animationDuration} ${rootStyle.animationTimingFunction} | transition=${rootStyle.transitionProperty} ${rootStyle.transitionDuration} | transformOrigin=${rootStyle.transformOrigin}`);
  const rows = [...root.querySelectorAll(rowSelector)];
  lines.push(`ROWS (${rows.length}):`);
  rows.forEach((row, index) => {
    const rect = box(row);
    lines.push(`  [${index}] ${(row.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 48)}  rect=${JSON.stringify(rect)}  checked=${row.getAttribute('aria-checked')}`);
  });
  const separators = [...root.querySelectorAll(separatorSelector)];
  separators.forEach((sep) => {
    const s = getComputedStyle(sep);
    lines.push(`SEPARATOR rect=${JSON.stringify(box(sep))} borderTop=${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor} bg=${s.backgroundColor} margin=${s.margin} height=${s.height}`);
  });
  const detail = full ? rows : rows.filter((row, index) => index < 2 || index === rows.length - 1);
  detail.forEach((row) => {
    lines.push(`ROW DETAIL "${(row.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`);
    visit(row, 1, panelStyle);
  });
  return lines;
}

async function tap(cdp, page, selector) {
  const center = await page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: center.x * SCALE, y: center.y * SCALE }] });
  await sleep(90);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function closeMenus(cdp, page, name) {
  if (name === 'gemini') {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  } else {
    const height = await page.evaluate(() => innerHeight);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195 * SCALE, y: (height - 150) * SCALE }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await sleep(700);
}

(async () => {
  const only = process.argv[2];
  const full = process.argv.includes('full');
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const pages = await browser.pages();
  const shots = path.join(os.tmpdir(), 'willow-emulator');
  fs.mkdirSync(shots, { recursive: true });
  for (const [name, config] of Object.entries(TABS)) {
    if (only && only !== name && only !== 'full') continue;
    const page = pages.find((candidate) => candidate.url().startsWith(config.url));
    const cdp = await page.createCDPSession();
    await page.bringToFront();
    await sleep(500);
    const env = await page.evaluate(() => `${innerWidth}x${innerHeight} coarse=${matchMedia('(pointer: coarse)').matches}`);
    console.log(`===================== ${name} (${env})`);
    const panelOpen = () => page.evaluate((s) => !!document.querySelector(s), config.panel);
    for (let attempt = 0; attempt < 3 && !(await panelOpen()); attempt++) {
      await tap(cdp, page, config.trigger);
      for (let waited = 0; waited < 2000 && !(await panelOpen()); waited += 100) await sleep(100);
    }
    await sleep(600);
    const lines = await page.evaluate(describe, config.panel, config.rows, config.separator, PROPS, full, DEFAULTS);
    console.log(lines ? lines.join('\n') : 'panel not found');
    fs.writeFileSync(path.join(shots, `${name}-menu.png`), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    if (config.submenuTrigger && lines) {
      await page.evaluate((panel, trigger) => document.querySelector(panel).querySelector(trigger).click(), config.panel, config.submenuTrigger);
      await sleep(900);
      const subLines = await page.evaluate(describe, config.submenu, config.submenuRows, config.separator, PROPS, full, DEFAULTS);
      console.log('----- submenu');
      console.log(subLines ? subLines.join('\n') : 'submenu not found');
      fs.writeFileSync(path.join(shots, `${name}-menu-submenu.png`), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    await closeMenus(cdp, page, name);
    await cdp.detach();
  }
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
