/** The tile's painted fill and radius, plus the close button and dialog surface. */
const { connect, save, sleep } = require('../ui-research/scrapers/notebooks/lib.cjs');

const PROBE = `() => {
  const item = document.querySelector('project-file-upload-item');
  if (!item) return { error: 'no tile' };
  const read = (el, label) => {
    if (!el) return { label, missing: true };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      label,
      cls: el.className.toString().slice(0, 90),
      rect: { w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 },
      cssWidth: cs.width,
      background: cs.backgroundColor,
      radius: cs.borderRadius,
      overflow: cs.overflow,
      position: cs.position,
      cursor: cs.cursor,
      transition: cs.transition,
    };
  };
  const out = [
    read(item, 'project-file-upload-item'),
    read(item.querySelector('.main-container'), '.main-container'),
    read(item.querySelector('.gem-attachment'), '.gem-attachment'),
    read(item.querySelector('mat-basic-chip'), 'mat-basic-chip'),
    read(item.querySelector('.gem-attachment-content'), '.gem-attachment-content'),
    read(document.querySelector('project-create-sources-dialog, .mat-mdc-dialog-surface, [role="dialog"] > *'), 'dialog surface'),
  ];
  const closeInner = item.querySelector('.gem-attachment-close-button button');
  if (closeInner) out.push(read(closeInner, 'close <button>'));
  const closeGlyph = item.querySelector('.gem-attachment-close-button mat-icon, .gem-attachment-close-button img');
  if (closeGlyph) {
    const cs = getComputedStyle(closeGlyph);
    out.push({ label: 'close glyph', cls: closeGlyph.className.toString().slice(0, 60), text: closeGlyph.textContent.trim(), fontFamily: cs.fontFamily, fontSize: cs.fontSize, color: cs.color, src: closeGlyph.getAttribute && closeGlyph.getAttribute('src') });
  }
  return out;
}`;

(async () => {
  const browser = await connect();
  try {
    const page = (await browser.pages()).find((p) => /gemini\.google\.com\/notebook/.test(p.url()));
    const open = await page.evaluate(() => !!document.querySelector('project-file-upload-item'));
    if (!open) {
      await page.evaluate(() => document.querySelector('gem-source-list-chip').click());
      await sleep(1600);
    }
    const res = await page.evaluate(new Function('return ' + PROBE)());
    save('src-chip/gemini-tile-fill.json', res);
    console.log(JSON.stringify(res, null, 2));
  } finally {
    await browser.disconnect();
  }
})();
