/*
 * Measures the mobile/tablet header model selector in the debug Chrome's Gemini and
 * Willow tabs: every element's box and type, then what changes under forced
 * :hover / :active / :focus-visible. Run while device-emulator.cjs holds the tabs.
 *
 *   node tools/scratch/model-pill-measure.cjs [gemini|willow]
 */
const puppeteer = require('puppeteer-core');

const ROOTS = {
  gemini: { url: 'https://gemini.google.com/', selector: 'button[aria-label^="Open mode picker"]' },
  willow: { url: 'http://localhost:3000/', selector: 'button.studio-mobile-model-button' },
};
const STATES = [['hover'], ['active'], ['focus', 'focus-visible']];
const PROPS = [
  'display', 'position', 'boxSizing', 'width', 'height', 'padding', 'margin', 'gap', 'borderRadius',
  'backgroundColor', 'opacity', 'transform', 'transition', 'overflow', 'fontFamily', 'fontSize',
  'fontWeight', 'lineHeight', 'letterSpacing', 'fontVariationSettings', 'color', 'content',
];
const DEFAULTS = {
  padding: '0px', margin: '0px', gap: 'normal', borderRadius: '0px', backgroundColor: 'rgba(0, 0, 0, 0)',
  opacity: '1', transform: 'none', transition: 'all', overflow: 'visible', content: 'normal',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function snapshot(selector, props) {
  const root = document.querySelector(selector);
  if (!root) return null;
  const rows = [];
  const read = (style) => Object.fromEntries(props.map((key) => [key, style[key]]));
  const visit = (el, path) => {
    const box = el.getBoundingClientRect();
    const pseudo = {};
    for (const which of ['::before', '::after']) {
      const style = getComputedStyle(el, which);
      if (style.content && style.content !== 'none' && style.content !== 'normal') pseudo[which] = read(style);
    }
    rows.push({
      path,
      tag: el.tagName.toLowerCase(),
      cls: String(el.className?.baseVal ?? el.className).trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.'),
      text: el.children.length ? '' : el.textContent.trim().slice(0, 24),
      rect: [box.x, box.y, box.width, box.height].map((n) => +n.toFixed(2)),
      style: read(getComputedStyle(el)),
      pseudo,
    });
    [...el.children].forEach((child, index) => visit(child, `${path}>${index}`));
  };
  visit(root, 'root');
  return rows;
}

const shown = (key, value) => value !== undefined && value !== DEFAULTS[key]
  && !(key === 'transition' && /^all( 0s)?( ease)?( 0s)?$/.test(value));

function printTree(rows) {
  for (const row of rows) {
    const style = Object.entries(row.style).filter(([key, value]) => shown(key, value)).map(([key, value]) => `${key}=${value}`);
    console.log(`  ${row.path} <${row.tag}${row.cls ? `.${row.cls}` : ''}>${row.text ? ` "${row.text}"` : ''} rect=${JSON.stringify(row.rect)}`);
    console.log(`      ${style.join(' | ')}`);
    for (const [which, pseudoStyle] of Object.entries(row.pseudo)) {
      const entries = Object.entries(pseudoStyle).filter(([key, value]) => shown(key, value)).map(([key, value]) => `${key}=${value}`);
      console.log(`      ${which}: ${entries.join(' | ')}`);
    }
  }
}

function printDiff(base, next) {
  let changed = false;
  next.forEach((row, index) => {
    const before = base[index];
    if (!before) return;
    const deltas = [];
    for (const key of Object.keys(row.style)) if (row.style[key] !== before.style[key]) deltas.push(`${key}: ${before.style[key]} -> ${row.style[key]}`);
    for (const which of new Set([...Object.keys(row.pseudo), ...Object.keys(before.pseudo)])) {
      const a = before.pseudo[which] || {};
      const b = row.pseudo[which] || {};
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[key] !== b[key]) deltas.push(`${which} ${key}: ${a[key]} -> ${b[key]}`);
    }
    if (JSON.stringify(row.rect) !== JSON.stringify(before.rect)) deltas.push(`rect: ${JSON.stringify(before.rect)} -> ${JSON.stringify(row.rect)}`);
    if (deltas.length) {
      changed = true;
      console.log(`  ${row.path} <${row.tag}${row.cls ? `.${row.cls}` : ''}>`);
      deltas.forEach((delta) => console.log(`      ${delta}`));
    }
  });
  if (!changed) console.log('  (no change)');
}

(async () => {
  const only = process.argv[2];
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const pages = await browser.pages();
  for (const [name, { url, selector }] of Object.entries(ROOTS)) {
    if (only && only !== name) continue;
    const page = pages.find((candidate) => candidate.url().startsWith(url));
    if (!page) {
      console.log(`===== ${name}: tab not found`);
      continue;
    }
    const env = await page.evaluate(() => `${innerWidth}x${innerHeight} dpr ${devicePixelRatio} coarse=${matchMedia('(pointer: coarse)').matches} hover=${matchMedia('(hover: hover)').matches}`);
    const base = await page.evaluate(snapshot, selector, PROPS);
    console.log(`===== ${name} (${env})`);
    if (!base) {
      console.log('  selector not found');
      continue;
    }
    printTree(base);

    const cdp = await page.createCDPSession();
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    for (const state of STATES) {
      await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: state });
      await sleep(600);
      console.log(`--- forced :${state.join(' :')}`);
      printDiff(base, await page.evaluate(snapshot, selector, PROPS));
    }
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    await cdp.detach();
  }
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
