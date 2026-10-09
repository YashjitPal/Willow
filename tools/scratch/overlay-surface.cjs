/**
 * Clicks a trigger on Gemini, then prints every painted element inside the open overlay
 * pane (bg, radius, shadow, padding, separators), then Escape. Never selects an item.
 *
 *   node tools/scratch/overlay-surface.cjs "<gemini trigger>"
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const trigger = process.argv[2];
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const gemini = (await browser.pages()).find((p) => p.url().startsWith('https://gemini.google.com'));
  await gemini.bringToFront();
  const el = await gemini.$(trigger);
  const r = await el.boundingBox();
  await gemini.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
  await new Promise((res) => setTimeout(res, 800));
  console.log(await gemini.evaluate(() => {
    const pane = [...document.querySelectorAll('.cdk-overlay-pane')].find((p) => p.getBoundingClientRect().width > 0);
    if (!pane) return 'no pane';
    const out = [];
    const r1 = (n) => Math.round(n * 10) / 10;
    for (const node of [pane, ...pane.querySelectorAll('*')]) {
      const cs = getComputedStyle(node);
      const b = node.getBoundingClientRect();
      const painted = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.boxShadow !== 'none' || cs.borderTopWidth !== '0px' || cs.borderBottomWidth !== '0px' || /divider|separator/.test(String(node.className)) || node.getAttribute('role') === 'separator';
      if (!painted) continue;
      const cls = typeof node.className === 'string' ? node.className.trim().split(/\s+/).filter((c) => !c.startsWith('ng-')).slice(0, 4).join('.') : '';
      out.push(`${node.tagName.toLowerCase()}.${cls} [${[b.x, b.y, b.width, b.height].map(r1)}] bg ${cs.backgroundColor} r ${cs.borderRadius} pad ${cs.padding} margin ${cs.margin} border-top ${cs.borderTopWidth} ${cs.borderTopColor} shadow ${cs.boxShadow}`);
    }
    const first = pane.querySelector('[role="menuitem"], button');
    if (first) {
      const icon = first.querySelector('mat-icon');
      const ic = icon && getComputedStyle(icon);
      out.push(`first item icon: ${icon?.getAttribute('fonticon')} ${icon?.className} font ${ic?.fontFamily} ${ic?.fontSize} fvs ${ic?.fontVariationSettings} box ${ic?.width}x${ic?.height}`);
      const label = [...first.querySelectorAll('*')].find((n) => !n.children.length && n.textContent.trim() && n.tagName !== 'MAT-ICON');
      const lc = label && getComputedStyle(label);
      out.push(`first item label: fvs ${lc?.fontVariationSettings} ls ${lc?.letterSpacing}`);
      out.push(`item gap ${getComputedStyle(first).gap} item r ${getComputedStyle(first).borderRadius} margin ${getComputedStyle(first).margin} width ${getComputedStyle(first).width}`);
    }
    return out.join('\n');
  }));
  await gemini.keyboard.press('Escape');
  browser.disconnect();
})();
