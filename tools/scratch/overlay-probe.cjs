/*
 * Clicks an element in the debug Chrome's Gemini or Willow tab and records the overlay it
 * opens — a Material menu, bottom sheet, dialog, or Willow's portalled equivalents: the
 * surface's box, colours, corners, padding, shadow and entrance animation, sampled per frame,
 * plus every row and text inside it. Closes it again with Escape unless --keep.
 *
 *   node tools/scratch/overlay-probe.cjs gemini|willow "<selector>" [index=0] [--keep] [--label=x]
 *
 * Nothing is chosen inside the overlay, so no state changes.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const URLS = { gemini: 'https://gemini.google.com/', willow: 'http://localhost:3000' };
const OVERLAYS = {
  gemini: '.cdk-overlay-pane',
  willow: '[role="menu"], [role="dialog"], [role="listbox"], .spark-goal-menu-panel, .willow-settings-sheet',
};

(async () => {
  const args = process.argv.slice(2);
  const keep = args.includes('--keep');
  const label = (args.find((a) => a.startsWith('--label=')) || '--label=probe').slice(8);
  const [app, selector, indexArg = '0'] = args.filter((a) => !a.startsWith('--'));
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((candidate) => candidate.url().startsWith(URLS[app]));
  await page.bringToFront();
  const data = await page.evaluate(async (sel, index, overlaySel) => {
    const r2 = (n) => Math.round(n * 10) / 10;
    const box = (el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(r2); };
    const targets = [...document.querySelectorAll(sel)].filter((el) => el.getBoundingClientRect().width > 0);
    const target = targets[index];
    if (!target) return { error: `no visible element #${index} for ${sel} (found ${targets.length})` };
    const before = new Set(document.querySelectorAll(overlaySel));
    const frames = [];
    const t0 = performance.now();
    target.click();
    const surfaceOf = (pane) => pane.querySelector('.mat-mdc-menu-panel, mat-bottom-sheet-container, mat-dialog-container, .mat-mdc-dialog-surface, [role="menu"], [role="dialog"]') || pane;
    await new Promise((resolve) => {
      const tick = () => {
        const fresh = [...document.querySelectorAll(overlaySel)].filter((el) => !before.has(el) && el.getBoundingClientRect().width > 0);
        const pane = fresh[fresh.length - 1];
        if (pane) {
          const s = surfaceOf(pane);
          const cs = getComputedStyle(s);
          frames.push({ t: Math.round(performance.now() - t0), rect: box(s), opacity: cs.opacity, transform: cs.transform });
        } else frames.push({ t: Math.round(performance.now() - t0), none: true });
        if (performance.now() - t0 < 500) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
    const fresh = [...document.querySelectorAll(overlaySel)].filter((el) => !before.has(el) && el.getBoundingClientRect().width > 0);
    const pane = fresh[fresh.length - 1];
    if (!pane) return { target: box(target), frames, error: 'nothing opened' };
    const s = surfaceOf(pane);
    const cs = getComputedStyle(s);
    const rows = [...s.querySelectorAll('[role^="menuitem"], [role="option"], button, a, mat-list-item')].filter((el) => el.getBoundingClientRect().width > 0).map((el) => {
      const rcs = getComputedStyle(el);
      const leaf = [...el.querySelectorAll('*'), el].find((c) => [...c.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && !/symbols|mat-icon/i.test(String(c.className)) && !/Symbols/.test(getComputedStyle(c).fontFamily));
      const lcs = leaf ? getComputedStyle(leaf) : null;
      const range = leaf ? document.createRange() : null;
      if (range) range.selectNodeContents(leaf);
      const icons = [...el.querySelectorAll('mat-icon, .google-symbols, .lumi-symbols, .luminous-symbols, .material-symbols-rounded')].filter((i) => i.getBoundingClientRect().width > 0).map((i) => ({ name: i.getAttribute('fonticon') || i.getAttribute('data-mat-icon-name') || i.textContent.trim().slice(0, 24), rect: box(i), size: getComputedStyle(i).fontSize, axes: getComputedStyle(i).fontVariationSettings, color: getComputedStyle(i).color }));
      return {
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
        rect: box(el), bg: rcs.backgroundColor, radius: rcs.borderRadius,
        padding: [rcs.paddingTop, rcs.paddingRight, rcs.paddingBottom, rcs.paddingLeft].join(' '), gap: rcs.gap,
        label: lcs ? { glyphs: range ? box({ getBoundingClientRect: () => range.getBoundingClientRect() }) : null, type: `${lcs.fontSize}/${lcs.lineHeight} w${lcs.fontWeight} ${lcs.fontVariationSettings}`, color: lcs.color } : null,
        icons,
      };
    });
    const backdrop = [...document.querySelectorAll('.cdk-overlay-backdrop, .willow-settings-sheet-backdrop, [data-dialog-backdrop]')].find((b) => b.getBoundingClientRect().width > 0);
    return {
      target: box(target),
      frames: frames.filter((f, i) => i === 0 || JSON.stringify({ ...f, t: 0 }) !== JSON.stringify({ ...frames[i - 1], t: 0 })),
      surface: {
        tag: s.tagName.toLowerCase(), cls: String(s.className).slice(0, 140), rect: box(s), bg: cs.backgroundColor, radius: cs.borderRadius,
        padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '), shadow: cs.boxShadow, border: cs.borderTopWidth === '0px' ? '' : `${cs.borderTopWidth} ${cs.borderTopColor}`,
        minWidth: cs.minWidth, maxWidth: cs.maxWidth, transformOrigin: cs.transformOrigin,
        animation: `${cs.animationName} ${cs.animationDuration} ${cs.animationTimingFunction}`,
      },
      backdrop: backdrop ? { rect: box(backdrop), bg: getComputedStyle(backdrop).backgroundColor, opacity: getComputedStyle(backdrop).opacity } : null,
      rows,
    };
  }, selector, Number(indexArg), OVERLAYS[app]);
  const dir = path.join(os.tmpdir(), 'willow-emulator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `overlay-${app}-${label}.json`), JSON.stringify(data, null, 1));
  if (data.error && !data.surface) console.log(JSON.stringify(data));
  else {
    console.log('target ', JSON.stringify(data.target));
    console.log('surface', JSON.stringify(data.surface));
    console.log('backdrop', JSON.stringify(data.backdrop));
    console.log('frames ', JSON.stringify(data.frames.slice(0, 10)));
    for (const row of data.rows) console.log('row', JSON.stringify(row));
  }
  if (!keep) {
    await page.keyboard.press('Escape');
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
