/**
 * Willow /search at the current emulator size: scans the empty page, then types a neutral
 * one-letter query into the field (local search only) and scans the results, then clears
 * the field. Reports sideways scrolling, elements past the screen edge, and whether result
 * titles truncate instead of pushing the row. Prints no chat titles.
 *
 *   node tools/scratch/search-check.cjs [--label=phone]
 */
const puppeteer = require('puppeteer-core');

const LABEL = (process.argv.find((a) => a.startsWith('--label=')) || '--label=search').slice(8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SCAN = () => {
  const W = innerWidth;
  const name = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : ''}`;
  const SKIP = '.sr-only, aside.studio-sidebar';
  const out = [];
  for (const el of [document.scrollingElement, ...document.querySelectorAll('main *')]) {
    const cs = getComputedStyle(el);
    if ((el === document.scrollingElement || /auto|scroll/.test(cs.overflowX)) && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && !el.matches(SKIP)) {
      out.push(`scrolls sideways: ${name(el)} ${el.scrollWidth}/${el.clientWidth}`);
    }
  }
  const reported = [];
  for (const el of document.querySelectorAll('main *')) {
    if (el.closest(SKIP) || reported.some((p) => p.contains(el))) continue;
    const b = el.getBoundingClientRect();
    if (b.width && b.height && (b.right > W + 0.5 || b.left < -0.5)) {
      out.push(`past edge: ${name(el)} [${Math.round(b.left)}..${Math.round(b.right)}]`);
      reported.push(el);
    }
  }
  const bar = document.querySelector('.willow-search-bar')?.getBoundingClientRect();
  const menu = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Open sidebar')?.getBoundingClientRect();
  const rows = [...document.querySelectorAll('.willow-search-result')];
  const titles = rows.map((r) => r.querySelector('.willow-search-result__title')).filter(Boolean);
  const truncating = titles.filter((t) => getComputedStyle(t).textOverflow === 'ellipsis').length;
  const rowsInside = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.left >= -0.5 && b.right <= W + 0.5; }).length;
  return {
    issues: out.slice(0, 8),
    bar: bar ? [Math.round(bar.x), Math.round(bar.y), Math.round(bar.width), Math.round(bar.height)] : null,
    menuBottom: menu ? Math.round(menu.bottom) : null,
    rows: rows.length,
    rowsInside,
    truncating,
    W,
  };
};

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  await page.bringToFront();
  if (new URL(page.url()).pathname !== '/search') {
    await page.evaluate(() => { history.pushState({}, '', '/search'); dispatchEvent(new PopStateEvent('popstate')); });
  }
  for (let i = 0; i < 30 && !(await page.evaluate(() => !!document.querySelector('.willow-search-bar'))); i++) await sleep(250);
  await sleep(800);
  const show = (state, r) => console.log(`[${LABEL}] ${state} @${r.W}px: ${r.issues.length ? r.issues.join(' | ') : 'no sideways scroll, nothing past the edge'}; field [${r.bar}] (menu button ends at y ${r.menuBottom}); rows ${r.rows}, ${r.rowsInside} inside the screen, ${r.truncating} titles truncate with an ellipsis`);
  show('empty', await page.evaluate(SCAN));
  await page.focus('.willow-search-bar__input');
  await page.keyboard.type('a', { delay: 30 });
  await sleep(1200);
  show('query "a"', await page.evaluate(SCAN));
  await page.evaluate(() => {
    const input = document.querySelector('.willow-search-bar__input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.blur();
  });
  browser.disconnect();
})();
