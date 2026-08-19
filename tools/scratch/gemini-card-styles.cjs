/**
 * Exact styles for Gemini's source tiles and the container that lays them out, plus the
 * root font-size — the numbers come back 0.8x the values this repo recorded earlier, and
 * that factor needs confirming before anything is copied.
 */
const { connect, save, sleep } = require('../ui-research/scrapers/notebooks/lib.cjs');

const PROBE = `() => {
  const item = document.querySelector('project-file-upload-item');
  if (!item) return { error: 'no source tile' };

  const px = (el, props) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const out = { rect: { x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100, w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 } };
    for (const p of props) out[p] = cs[p];
    return out;
  };
  const BOX = ['display','width','height','padding','margin','gap','rowGap','columnGap','flexWrap','flexDirection','gridTemplateColumns','alignItems','justifyContent','backgroundColor','borderRadius','overflow','position','boxSizing','border'];
  const TEXT = ['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','color','fontVariationSettings','textOverflow','whiteSpace','overflow','webkitLineClamp','display','wordBreak','textAlign'];

  const out = {
    rootFontSize: getComputedStyle(document.documentElement).fontSize,
    bodyFontSize: getComputedStyle(document.body).fontSize,
    devicePixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    zoom: getComputedStyle(document.documentElement).zoom,
  };

  // Container chain above the tile.
  out.ancestors = [];
  let el = item.parentElement;
  for (let i = 0; i < 4 && el; i += 1) {
    out.ancestors.push({ tag: el.tagName.toLowerCase(), cls: el.className.toString(), ...px(el, BOX) });
    el = el.parentElement;
  }

  out.item = { tag: 'project-file-upload-item', cls: item.className, ...px(item, BOX) };
  const attach = item.querySelector('.gem-attachment, mat-basic-chip');
  if (attach) out.attachment = { cls: attach.className, ...px(attach, BOX) };
  const content = item.querySelector('.gem-attachment-content');
  if (content) out.content = { cls: content.className, ...px(content, BOX) };
  const icon = item.querySelector('.gem-attachment-icon');
  if (icon) {
    out.icon = { cls: icon.className, ...px(icon, BOX) };
    const img = icon.querySelector('img');
    if (img) out.iconImg = { src: img.getAttribute('src'), ...px(img, ['width','height','objectFit','borderRadius']) };
  }
  const text = item.querySelector('.gem-attachment-text');
  if (text) out.text = { cls: text.className, content: text.textContent.trim(), title: text.getAttribute('title'), ...px(text, TEXT) };
  const close = item.querySelector('.gem-attachment-close-button');
  if (close) out.close = { cls: close.className, ...px(close, BOX.concat(['visibility','opacity'])) };

  // Every tile, so the icon sources and text can be compared to the panel order.
  out.tiles = Array.from(document.querySelectorAll('project-file-upload-item')).map((t) => {
    const img = t.querySelector('.gem-attachment-icon img');
    const label = t.querySelector('.gem-attachment-text');
    const r = t.getBoundingClientRect();
    return {
      x: Math.round(r.x * 10) / 10,
      icon: img ? img.getAttribute('src') : null,
      label: label ? label.textContent.trim() : null,
      title: label ? label.getAttribute('title') : null,
      tooltip: t.querySelector('[mattooltip]') ? t.querySelector('[mattooltip]').getAttribute('mattooltip') : null,
    };
  });
  return out;
}`;

(async () => {
  const browser = await connect();
  try {
    const page = (await browser.pages()).find((p) => /gemini\.google\.com\/notebook/.test(p.url()));
    const alreadyOpen = await page.evaluate(() => !!document.querySelector('project-file-upload-item'));
    if (!alreadyOpen) {
      await page.evaluate(() => document.querySelector('gem-source-list-chip').click());
      await sleep(1600);
    }
    const res = await page.evaluate(new Function('return ' + PROBE)());
    save('src-chip/gemini-card-styles.json', res);
    console.log(JSON.stringify(res, null, 2));
  } finally {
    await browser.disconnect();
  }
})();
