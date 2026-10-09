/**
 * Measures the open "Thinking steps" panel in Gemini (default) or Willow (--willow):
 * every painted / sized element under the panel root with box, type, colour, padding,
 * border, radius, background image (the dotted rail). Text is printed only for UI labels;
 * thought titles and bodies are reduced to their length. Read-only.
 *
 *   node tools/scratch/thinking-measure.cjs [--willow] [--depth=12]
 */
const puppeteer = require('puppeteer-core');

const onWillow = process.argv.includes('--willow');
const depthArg = process.argv.find((a) => a.startsWith('--depth='));
const MAX_DEPTH = depthArg ? Number(depthArg.slice(8)) : 12;

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => (onWillow
    ? p.url().startsWith('http://localhost:3000') && !p.url().includes('/media')
    : p.url().startsWith('https://gemini.google.com')));
  console.log(await page.evaluate((maxDepth, willow) => {
    const SAFE = /^(Thinking steps|Done|Error|Used .{1,40}|Close sidebar|Close)$/;
    const root = willow
      ? document.querySelector('aside[aria-label="Thinking steps"]')
      : (document.querySelector('context-sidebar') || [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent.trim() === 'Thinking steps')?.closest('context-sidebar, mat-sidenav, aside, [role="dialog"], .cdk-overlay-pane'));
    if (!root) return 'no panel';
    const r1 = (n) => Math.round(n * 10) / 10;
    const out = [];
    const walk = (el, depth) => {
      if (depth > maxDepth || out.length > 160) return;
      const b = el.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) { [...el.children].forEach((c) => walk(c, depth)); return; }
      const cs = getComputedStyle(el);
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter((c) => !c.startsWith('ng-') && !c.startsWith('_ng')).slice(0, 4).join('.') : '';
      const leaf = !el.children.length;
      const t = leaf ? (el.textContent || '').trim() : '';
      const text = t ? (SAFE.test(t) ? ` "${t}"` : ` text(${t.length})`) : '';
      const bits = [
        cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? `bg ${cs.backgroundColor}` : '',
        cs.backgroundImage !== 'none' ? `bgimg ${cs.backgroundImage.slice(0, 90)} size ${cs.backgroundSize} pos ${cs.backgroundPosition} rep ${cs.backgroundRepeat}` : '',
        cs.borderRadius !== '0px' ? `r ${cs.borderRadius}` : '',
        cs.borderTopWidth !== '0px' || cs.borderLeftWidth !== '0px' ? `border ${cs.borderTopWidth}/${cs.borderLeftWidth} ${cs.borderTopStyle} ${cs.borderTopColor}` : '',
        cs.boxShadow !== 'none' ? `shadow ${cs.boxShadow.slice(0, 60)}` : '',
        cs.padding !== '0px' ? `pad ${cs.padding}` : '',
        cs.margin !== '0px' ? `margin ${cs.margin}` : '',
        cs.gap !== 'normal' ? `gap ${cs.gap}` : '',
        cs.position !== 'static' ? `pos ${cs.position}` : '',
        /auto|scroll/.test(cs.overflowY) ? `overflowY ${cs.overflowY}` : '',
        el.tagName === 'MAT-ICON' || /symbols/.test(cls) ? `icon ${el.getAttribute('fonticon') || el.textContent.trim()} ${cs.fontFamily.split(',')[0]} fvs ${cs.fontVariationSettings}` : '',
        leaf && t ? `fvs ${cs.fontVariationSettings}` : '',
        el.getAttribute('aria-label') ? `aria "${el.getAttribute('aria-label')}"` : '',
      ].filter(Boolean).join(' ');
      out.push(`${' '.repeat(depth)}${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} [${[b.x, b.y, b.width, b.height].map(r1)}] ${cs.fontSize}/${cs.lineHeight} w${cs.fontWeight} ${cs.color} ${bits}${text}`);
      if (el.tagName !== 'svg') [...el.children].forEach((c) => walk(c, depth + 1));
    };
    walk(root, 0);
    let host = root.parentElement;
    const chain = [];
    for (let i = 0; i < 4 && host; i++, host = host.parentElement) {
      const b = host.getBoundingClientRect();
      const cs = getComputedStyle(host);
      chain.push(`${host.tagName.toLowerCase()}.${String(host.className).split(/\s+/).slice(0, 3).join('.')} [${[b.x, b.y, b.width, b.height].map(r1)}] pos ${cs.position} z ${cs.zIndex} bg ${cs.backgroundColor}`);
    }
    return `${out.join('\n')}\nparents:\n  ${chain.join('\n  ')}`;
  }, MAX_DEPTH, onWillow));
  browser.disconnect();
})();
