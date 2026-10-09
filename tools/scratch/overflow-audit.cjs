/**
 * Layout integrity on the current Willow (or Gemini) page: every visible element that
 * spills past the viewport horizontally, outside a container that scrolls on purpose, and
 * every text block whose content is cut by `overflow: hidden` without an ellipsis or a
 * line clamp.
 *
 *   node tools/scratch/overflow-audit.cjs willow|gemini [label]
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const which = process.argv[2] || 'willow';
  const label = process.argv[3] || '';
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const prefix = which === 'gemini' ? 'https://gemini.google.com' : 'http://localhost:3000';
  const page = (await browser.pages()).find((p) => p.url().startsWith(prefix));
  if (!page) throw new Error(`no ${which} tab`);

  const report = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const scrollsX = (el) => {
      for (let node = el.parentElement; node; node = node.parentElement) {
        const ox = getComputedStyle(node).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
      }
      return false;
    };
    const visible = (el, cs) => {
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const name = (el) => {
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${text ? ` "${text}"` : ''}`;
    };
    const spills = [];
    const clipped = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (!visible(el, cs)) continue;
      if (cs.position === 'fixed' && el.closest('[aria-hidden="true"]')) continue;
      const r = el.getBoundingClientRect();
      // Wholly off-canvas (a closed drawer) and 1px visually-hidden text are deliberate.
      if (r.right <= 0.5 || r.left >= vw - 0.5 || (r.width <= 1 && r.height <= 1)) continue;
      if ((r.right > vw + 0.5 || r.left < -0.5) && !scrollsX(el)) {
        spills.push(`${name(el)} [${Math.round(r.left)}..${Math.round(r.right)}] vw ${vw}`);
      }
      const hidesX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
      if (hidesX && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis'
        && cs.webkitLineClamp === 'none' && el.childElementCount === 0 && (el.textContent || '').trim()) {
        clipped.push(`${name(el)} scrollW ${el.scrollWidth} > ${el.clientWidth}`);
      }
    }
    return { vw, spills: spills.slice(0, 25), spillCount: spills.length, clipped: clipped.slice(0, 15) };
  });

  console.log(`${which}${label ? ` (${label})` : ''} @ ${report.vw}px: ${report.spillCount} spilling, ${report.clipped.length} clipped`);
  for (const line of report.spills) console.log(`  spill  ${line}`);
  for (const line of report.clipped) console.log(`  clip   ${line}`);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
