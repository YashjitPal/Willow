/*
 * Dumps the element tree under a selector in the debug Chrome's Gemini or Willow tab:
 * box, and only the layout/paint properties that are set (background, radius, padding,
 * margin, gap, flex/grid, overflow, position, borders), plus direct text.
 *
 *   node tools/scratch/dom-tree.cjs gemini|willow "<rootSelector>" [depth=7] [maxLines=160]
 */
const puppeteer = require('puppeteer-core');

const URLS = { gemini: 'https://gemini.google.com/', willow: 'http://localhost:3000' };

(async () => {
  const [app, rootSelector, depthArg = '7', maxArg = '160'] = process.argv.slice(2);
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((candidate) => candidate.url().startsWith(URLS[app]));
  const lines = await page.evaluate((rootSel, depthLimit) => {
    const root = document.querySelector(rootSel);
    if (!root) return [`no element for ${rootSel}`];
    const out = [];
    const r2 = (n) => Math.round(n * 10) / 10;
    const walk = (el, depth) => {
      if (depth > depthLimit) return;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === 'none') return;
      const bits = [];
      if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') bits.push(`bg ${cs.backgroundColor}`);
      if (cs.borderRadius !== '0px') bits.push(`r ${cs.borderRadius}`);
      const pad = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' ');
      if (pad !== '0px 0px 0px 0px') bits.push(`pad ${pad}`);
      const mar = [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].join(' ');
      if (mar !== '0px 0px 0px 0px') bits.push(`mar ${mar}`);
      if (cs.gap && cs.gap !== 'normal') bits.push(`gap ${cs.gap}`);
      if (/flex|grid/.test(cs.display)) bits.push(`${cs.display} ${cs.flexDirection}${cs.flexWrap === 'wrap' ? ' wrap' : ''}`);
      if (cs.overflowY !== 'visible' || cs.overflowX !== 'visible') bits.push(`ovf ${cs.overflowX}/${cs.overflowY}${el.scrollHeight > el.clientHeight + 1 ? ` sh${el.scrollHeight}>ch${el.clientHeight}` : ''}`);
      if (cs.position !== 'static') bits.push(cs.position);
      if (cs.borderTopWidth !== '0px') bits.push(`border ${cs.borderTopWidth} ${cs.borderTopColor}`);
      if (cs.maxWidth !== 'none') bits.push(`maxW ${cs.maxWidth}`);
      if (cs.boxShadow !== 'none') bits.push('shadow');
      if (cs.opacity !== '1') bits.push(`op ${cs.opacity}`);
      if (cs.transform !== 'none') bits.push(`tf ${cs.transform}`);
      const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').slice(0, 32);
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 4).join('.') : '';
      out.push(`${'  '.repeat(depth)}${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} [${[r.x, r.y, r.width, r.height].map(r2).join(',')}] ${bits.join(' | ')}${text ? ` "${text}"` : ''}`);
      for (const child of el.children) walk(child, depth + 1);
    };
    walk(root, 0);
    return out;
  }, rootSelector, Number(depthArg));
  console.log(lines.slice(0, Number(maxArg)).join('\n'));
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
