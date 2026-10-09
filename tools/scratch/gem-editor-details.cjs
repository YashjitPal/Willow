/**
 * Small details of Gemini's Gem editor that the tree dump does not show: every icon's
 * ligature and font, placeholder colours, the focused field's outline, and the Knowledge
 * row's inner markup. Read-only.
 *
 *   node tools/scratch/gem-editor-details.cjs
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('https://gemini.google.com'));
  if (!page) throw new Error('no gemini tab');
  const out = await page.evaluate(() => {
    const root = document.querySelector('bots-creation-window');
    const r1 = (n) => Math.round(n * 10) / 10;
    const box = (el) => { const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(r1).join(','); };
    const icons = [...root.querySelectorAll('mat-icon')].filter((m) => m.getBoundingClientRect().width > 0).map((m) => {
      const cs = getComputedStyle(m);
      const name = m.getAttribute('fonticon') || m.textContent.trim() || (m.querySelector('svg') ? 'svg' : '');
      return `${name} [${box(m)}] ${cs.fontFamily.split(',')[0]} ${cs.fontSize} w${cs.fontWeight} ${cs.color} in ${m.parentElement.className.split(' ')[0] || m.parentElement.tagName.toLowerCase()}`;
    });
    const ph = (sel) => {
      const el = root.querySelector(sel);
      if (!el) return 'none';
      const cs = getComputedStyle(el, '::placeholder');
      return `${el.placeholder} | ${cs.color} fvs ${cs.fontVariationSettings}`;
    };
    const nameWrapper = root.querySelector('.name-input-container .mdc-text-field');
    const outline = nameWrapper && [...nameWrapper.querySelectorAll('*')].map((el) => getComputedStyle(el)).find((cs) => cs.borderTopWidth !== '0px');
    const instrPh = root.querySelector('.instruction-bg p');
    const knowledge = root.querySelector('.knowledge-files-content');
    return {
      icons,
      namePlaceholder: ph('.name-input-container input'),
      descPlaceholder: ph('.description-input-container textarea'),
      instructionPlaceholder: instrPh ? `${instrPh.textContent.trim().slice(0, 300)} | ${getComputedStyle(instrPh).color}` : 'none',
      nameOutline: outline ? `${outline.borderTopWidth} ${outline.borderTopStyle} ${outline.borderTopColor}` : 'none',
      focused: document.activeElement?.tagName + '.' + String(document.activeElement?.className).slice(0, 60),
      knowledgeHtml: knowledge ? knowledge.innerHTML.replace(/<!--.*?-->/g, '').replace(/ _ngcontent-[^=]+=""/g, '').replace(/ ng-tns-[^ "]+/g, '').slice(0, 1500) : 'none',
      checkbox: (() => {
        const cb = root.querySelector('.hide-gem-knowledge-citations-checkbox');
        if (!cb) return 'none';
        const input = cb.querySelector('input');
        const bg = cb.querySelector('.mdc-checkbox__background');
        const lab = cb.querySelector('label');
        return `disabled=${input?.disabled} bg [${bg ? box(bg) : '-'}] border ${bg ? getComputedStyle(bg).border : '-'} r ${bg ? getComputedStyle(bg).borderRadius : '-'} label "${lab?.textContent.trim()}" ${lab ? getComputedStyle(lab).color : ''}`;
      })(),
      powerUp: (() => {
        const pu = root.querySelector('input-power-up button');
        return pu ? `${pu.getAttribute('aria-label')} disabled=${pu.disabled} [${box(pu)}] inner=${pu.innerHTML.replace(/<!--.*?-->/g, '').length} chars` : 'none';
      })(),
      tooltips: [...root.querySelectorAll('[mattooltip], .mat-mdc-tooltip-trigger')].map((el) => el.getAttribute('aria-label') || el.getAttribute('mattooltip') || el.textContent.trim().slice(0, 30)),
    };
  });
  console.log(JSON.stringify(out, null, 2));
  browser.disconnect();
})();
