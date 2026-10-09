/*
 * Records every visible text leaf, icon and control on the current page of the debug
 * Chrome's Gemini or Willow tab — box, type, colours, and the surface each one sits on —
 * skipping the side drawer. Pair two captures with inventory-diff.cjs.
 *
 *   node tools/scratch/page-inventory.cjs gemini|willow <label> [rootSelector] [--all]
 *
 * --all keeps elements scrolled out of the viewport (inside scrollers) as well.
 * Writes %TEMP%\willow-emulator\inv-<app>-<label>.json and prints a digest.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const URLS = { gemini: 'https://gemini.google.com/', willow: 'http://localhost:3000' };
/* Only the drawers. Gemini's `side-navigation-v2` is a box-less wrapper around the whole app. */
const SKIP = 'bard-sidenav, .studio-sidebar, .studio-sidebar-mobile-scrim';

function inventory(rootSelector, skipSelector, keepOffscreen) {
  const r2 = (n) => Math.round(n * 10) / 10;
  const box = (r) => [r.x, r.y, r.width, r.height].map(r2);
  const root = (rootSelector && document.querySelector(rootSelector)) || document.body;
  const skipped = (el) => !!el.closest(skipSelector);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 0.5 || r.height < 0.5) return false;
    if (!keepOffscreen && (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth)) return false;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  const surfaceOf = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const painted = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.borderTopWidth !== '0px' || cs.boxShadow !== 'none';
      const interactive = /^(BUTTON|A|INPUT|TEXTAREA|SELECT)$/.test(n.tagName) || n.getAttribute('role') === 'button';
      if (painted || interactive) {
        return {
          tag: n.tagName.toLowerCase(),
          cls: String(n.className?.baseVal ?? n.className ?? '').trim().split(/\s+/).slice(0, 3).join('.'),
          rect: box(n.getBoundingClientRect()),
          bg: cs.backgroundColor,
          border: cs.borderTopWidth === '0px' ? '' : `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
          radius: cs.borderRadius,
          padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
          shadow: cs.boxShadow === 'none' ? '' : cs.boxShadow,
        };
      }
    }
    return null;
  };
  const isIcon = (el, cs) => el.tagName === 'MAT-ICON' || /symbols|material-icons|mat-icon|lumi-symbols/i.test(String(el.className?.baseVal ?? el.className ?? '')) || /Symbols|Material Icons/i.test(cs.fontFamily);
  const items = [];
  const seen = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el || seen.has(el) || skipped(el) || !visible(el)) continue;
    if (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    const range = document.createRange();
    range.selectNodeContents(node);
    const g = range.getBoundingClientRect();
    items.push({
      kind: isIcon(el, cs) ? 'icon' : 'text',
      text: text.slice(0, 60),
      rect: box(el.getBoundingClientRect()),
      glyphs: box(g),
      size: cs.fontSize, lh: cs.lineHeight, weight: cs.fontWeight, axes: cs.fontVariationSettings,
      family: cs.fontFamily.split(',')[0].replace(/"/g, ''),
      color: cs.color, ls: cs.letterSpacing, align: cs.textAlign,
      surface: surfaceOf(el.parentElement || el),
    });
  }
  for (const el of root.querySelectorAll('mat-icon, [data-mat-icon-name], .google-symbols, .luminous-symbols, .material-symbols-rounded, svg, img, input, textarea, [role="switch"], [role="slider"]')) {
    if (seen.has(el) || skipped(el) || !visible(el) || (el.tagName.toLowerCase() === 'svg' && el.parentElement?.closest('svg'))) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    const tag = el.tagName.toLowerCase();
    items.push({
      kind: tag === 'input' || tag === 'textarea' ? 'field' : tag === 'img' ? 'img' : tag === 'svg' ? 'svg' : 'icon',
      text: el.getAttribute('data-mat-icon-name') || el.getAttribute('fonticon') || el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('alt') || el.textContent.trim().slice(0, 30),
      rect: box(el.getBoundingClientRect()),
      size: cs.fontSize, lh: cs.lineHeight, weight: cs.fontWeight, axes: cs.fontVariationSettings,
      color: cs.color, family: cs.fontFamily.split(',')[0].replace(/"/g, ''),
      surface: surfaceOf(tag === 'input' || tag === 'textarea' ? el : el.parentElement || el),
    });
  }
  items.sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0]);
  const scrollers = [...document.querySelectorAll('*')].filter((el) => {
    if (skipped(el)) return false;
    const cs = getComputedStyle(el);
    return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 40;
  }).map((el) => ({ cls: String(el.className?.baseVal ?? el.className ?? '').slice(0, 80), tag: el.tagName.toLowerCase(), rect: box(el.getBoundingClientRect()), scrollTop: el.scrollTop, scrollHeight: el.scrollHeight }));
  return { viewport: `${innerWidth}x${innerHeight}`, url: location.href, items, scrollers };
}

(async () => {
  const args = process.argv.slice(2);
  const keepOffscreen = args.includes('--all');
  const [app, label, rootSelector] = args.filter((a) => !a.startsWith('--'));
  if (!URLS[app] || !label) throw new Error('usage: page-inventory.cjs gemini|willow <label> [rootSelector] [--all]');
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  // Gemini's Activity entry is Google's My Activity, on its own origin; capture it as "gemini".
  const origins = app === 'gemini' ? [URLS.gemini, 'https://myactivity.google.com/'] : [URLS[app]];
  const page = (await browser.pages()).find((candidate) => origins.some((origin) => candidate.url().startsWith(origin)));
  await page.bringToFront();
  /* Entrance animations freeze at their first frame in a background tab, so read settled
   * layout: animations and transitions off while measuring, then restored. */
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.id = '__inventory-settle';
    style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
    document.head.appendChild(style);
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const data = await page.evaluate(inventory, rootSelector || null, SKIP, keepOffscreen);
  await page.evaluate(() => document.getElementById('__inventory-settle')?.remove());
  const dir = path.join(os.tmpdir(), 'willow-emulator');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `inv-${app}-${label}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
  console.log(`== ${app} ${data.viewport} ${data.url}  ${data.items.length} items  (${file})`);
  for (const s of data.scrollers) console.log(`SCROLLER ${s.tag}.${s.cls} [${s.rect.join(',')}] top=${s.scrollTop} h=${s.scrollHeight}`);
  for (const item of data.items) {
    const sf = item.surface ? ` @${item.surface.tag}[${item.surface.rect.join(',')}${item.surface.bg !== 'rgba(0, 0, 0, 0)' ? ` ${item.surface.bg}` : ''}${item.surface.radius !== '0px' ? ` r${item.surface.radius}` : ''}]` : '';
    console.log(`${item.kind.toUpperCase().padEnd(5)} [${item.rect.join(',')}] ${item.size}/${item.lh} w${item.weight} ${item.color} "${item.text}"${sf}`);
  }
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
