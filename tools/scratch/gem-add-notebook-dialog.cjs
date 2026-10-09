/**
 * Gemini Gem editor: opens knowledge "+" → "Gemini Notebook" and measures the "Add
 * notebook" dialog — structure, boxes and type only. Row text is reduced to its length so
 * the user's notebook names are never printed. Hovers the second row for the hover state;
 * never clicks a row or Add. Closes with Escape.
 */
const puppeteer = require('puppeteer-core');

const measure = () => {
  const SAFE_TEXT = /^(Add notebook|Recent|Add|Close|\d+ sources?.*)$/;
  const pane = [...document.querySelectorAll('.cdk-overlay-pane')].find((p) => p.querySelector('mat-dialog-container, [role="dialog"]'));
  if (!pane) return 'no dialog';
  const r1 = (n) => Math.round(n * 10) / 10;
  const out = [];
  const seen = new Set();
  const walk = (el, depth) => {
    if (depth > 14 || out.length > 140) return;
    const b = el.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) {
      if (el.tagName !== 'svg') [...el.children].forEach((c) => walk(c, depth));
      return;
    }
    const cs = getComputedStyle(el);
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter((c) => !c.startsWith('ng-') && !c.startsWith('_ngcontent')).slice(0, 4).join('.') : (el.className?.baseVal || '');
    const leaf = !el.children.length || el.tagName === 'svg';
    let text = '';
    if (leaf && el.tagName !== 'svg') {
      const t = el.textContent.trim();
      text = t ? (SAFE_TEXT.test(t) && !/sources?/.test(t) ? ` "${t}"` : ` text(len ${t.length}${/sources?/.test(t) ? ', meta' : ''})`) : '';
    }
    const sig = `${el.tagName}.${cls}.${depth}`;
    const isRowRepeat = /notebook-item|list-item|mat-mdc-list-item|option/.test(cls) && seen.has(sig);
    if (isRowRepeat) return;
    seen.add(sig);
    const paint = [
      cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? `bg ${cs.backgroundColor}` : '',
      cs.borderRadius !== '0px' ? `r ${cs.borderRadius}` : '',
      cs.boxShadow !== 'none' ? `shadow ${cs.boxShadow.slice(0, 70)}` : '',
      cs.padding !== '0px' ? `pad ${cs.padding}` : '',
      cs.borderTopWidth !== '0px' ? `bt ${cs.borderTopWidth} ${cs.borderTopColor}` : '',
      cs.borderBottomWidth !== '0px' ? `bb ${cs.borderBottomWidth} ${cs.borderBottomColor}` : '',
      el.tagName === 'MAT-ICON' ? `icon ${el.getAttribute('fonticon') || el.textContent.trim()} ${cs.fontFamily.split(',')[0]} fvs ${cs.fontVariationSettings}` : '',
      el.tagName === 'svg' || el.tagName === 'IMG' ? `${el.tagName} ${el.getAttribute('viewBox') || el.getAttribute('src')?.slice(0, 80) || ''}` : '',
      el.getAttribute('role') ? `role=${el.getAttribute('role')}` : '',
      el.getAttribute('aria-selected') ? `aria-selected=${el.getAttribute('aria-selected')}` : '',
      el.getAttribute('aria-multiselectable') ? `multi=${el.getAttribute('aria-multiselectable')}` : '',
      el.disabled ? 'disabled' : '',
      cs.overflowY !== 'visible' ? `overflowY ${cs.overflowY}` : '',
    ].filter(Boolean).join(' ');
    out.push(`${' '.repeat(depth)}${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} [${[b.x, b.y, b.width, b.height].map(r1)}] ${cs.fontSize}/${cs.lineHeight} w${cs.fontWeight} ${cs.color} ${paint}${text}`);
    if (el.tagName !== 'svg') [...el.children].forEach((c) => walk(c, depth + 1));
  };
  walk(pane, 0);
  const rows = pane.querySelectorAll('[role="option"], [role="listitem"], mat-list-option, .notebook-item, li');
  out.push(`rows: ${rows.length}`);
  return out.join('\n');
};

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const gemini = (await browser.pages()).find((p) => p.url().startsWith('https://gemini.google.com'));
  await gemini.bringToFront();
  const trigger = await gemini.$('bots-creation-window .upload-card-button');
  const tr = await trigger.boundingBox();
  await gemini.mouse.click(tr.x + tr.width / 2, tr.y + tr.height / 2);
  await new Promise((r) => setTimeout(r, 800));
  const row = await gemini.evaluateHandle(() => [...document.querySelectorAll('.cdk-overlay-pane button, .cdk-overlay-pane [role="menuitem"]')].find((b) => /Gemini Notebook/.test(b.textContent)));
  const rr = await row.boundingBox();
  await gemini.mouse.click(rr.x + rr.width / 2, rr.y + rr.height / 2);
  await new Promise((r) => setTimeout(r, 1500));
  await gemini.mouse.move(5, 5);
  await new Promise((r) => setTimeout(r, 300));
  console.log(await gemini.evaluate(measure));
  const second = await gemini.evaluate(() => {
    const pane = [...document.querySelectorAll('.cdk-overlay-pane')].find((p) => p.querySelector('mat-dialog-container, [role="dialog"]'));
    const rows = [...pane.querySelectorAll('[role="option"], [role="listitem"], mat-list-option, .notebook-item, li')];
    const el = rows[1];
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  if (second) {
    await gemini.mouse.move(second.x, second.y);
    await new Promise((r) => setTimeout(r, 400));
    console.log('HOVER second row:', await gemini.evaluate((pt) => {
      let el = document.elementFromPoint(pt.x, pt.y);
      const out = [];
      for (let i = 0; el && i < 6; i++, el = el.parentElement) {
        const cs = getComputedStyle(el);
        out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/).slice(0, 2).join('.')} bg ${cs.backgroundColor} r ${cs.borderRadius}`);
        const before = getComputedStyle(el, '::before');
        if (before.content !== 'none' && before.backgroundColor !== 'rgba(0, 0, 0, 0)') out.push(`  ::before bg ${before.backgroundColor} opacity ${before.opacity}`);
      }
      return out.join('\n');
    }, second));
  }
  await gemini.screenshot({ path: `${process.env.TEMP}/g-add-notebook.png`, clip: { x: 460, y: 115, width: 620, height: 600 } });
  for (let i = 0; i < 2; i++) {
    await gemini.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 400));
  }
  browser.disconnect();
})();
