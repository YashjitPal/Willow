/**
 * Willow (Gems/chat tab, never the media tab): finds what does not fit the viewport.
 *
 * Reports (1) every scroll container that can scroll sideways although it is not meant to
 * — a page that slides left and right — and (2) the outermost elements whose box runs past
 * the left or right edge of the screen, skipping anything inside an intentional sideways
 * scroller (carousels, prompt-card rows) and anything already reported. Text is never
 * printed; elements are named by tag and classes.
 *
 *   node tools/scratch/overflow-scan.cjs [--label=name] [--root="<selector>"]
 */
const puppeteer = require('puppeteer-core');

const flag = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const LABEL = flag('label', 'scan');
const ROOT = flag('root', 'body');
// Extra selectors for rows that are meant to scroll sideways, e.g. --ok=".code-hero-pills,.code-bento-grid".
const OK = flag('ok', '');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  const result = await page.evaluate((rootSel, ok) => {
    const W = innerWidth;
    const root = document.querySelector(rootSel) || document.body;
    const name = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 5).join('.')}` : ''}`;
    const r1 = (n) => Math.round(n * 10) / 10;
    const INTENTIONAL = `.gems-premade-cards, .gem-zero-starters, [data-scroll-x], .snap-x, .overflow-x-auto, .sr-only, aside.studio-sidebar${ok ? `, ${ok}` : ''}`;
    const isVisible = (el) => {
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0;
    };
    const sideways = [];
    for (const el of [document.scrollingElement, ...root.querySelectorAll('*')]) {
      if (!el || !isVisible(el)) continue;
      const cs = getComputedStyle(el);
      const scrollsX = el === document.scrollingElement || /auto|scroll/.test(cs.overflowX);
      if (scrollsX && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && !el.matches(INTENTIONAL)) {
        sideways.push(`${name(el)} scrollW ${el.scrollWidth} clientW ${el.clientWidth} scrollLeft ${r1(el.scrollLeft)}`);
      }
    }
    const offenders = [];
    const reported = [];
    for (const el of root.querySelectorAll('*')) {
      if (!isVisible(el) || el.closest(INTENTIONAL)) continue;
      if (reported.some((parent) => parent.contains(el))) continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      if (b.right > W + 0.5 || b.left < -0.5) {
        // Clipped by an ancestor that hides overflow? Still worth knowing, but say so.
        let clip = null;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const pcs = getComputedStyle(p);
          if (/hidden|clip/.test(pcs.overflowX)) { clip = p; break; }
        }
        offenders.push(`${name(el)} [${r1(b.left)}..${r1(b.right)}] w ${r1(b.width)}${clip ? ` (clipped by ${name(clip)})` : ''}`);
        reported.push(el);
      }
    }
    return { W, sideways, offenders: offenders.slice(0, 14), more: Math.max(0, offenders.length - 14), path: location.pathname };
  }, ROOT, OK);
  console.log(`[${LABEL}] ${result.path} @${result.W}px: ${result.sideways.length ? 'SIDEWAYS SCROLL' : 'no sideways scroll'}; ${result.offenders.length ? `${result.offenders.length} past the edge` : 'nothing past the edge'}`);
  for (const s of result.sideways) console.log(`   scrolls sideways: ${s}`);
  for (const o of result.offenders) console.log(`   past edge: ${o}`);
  if (result.more) console.log(`   …and ${result.more} more`);
  browser.disconnect();
})();
