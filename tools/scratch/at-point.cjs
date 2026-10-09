/**
 * The element under a viewport point, walked up to the nearest link or button: its markup
 * (trimmed), then every element in that subtree with box and type styles. Read-only.
 *
 *   node tools/scratch/at-point.cjs gemini|willow <x> <y>
 */
const puppeteer = require('puppeteer-core');

const ORIGINS = { gemini: 'https://gemini.google.com', willow: 'http://localhost:3000' };

(async () => {
  const [which = 'gemini', x = '100', y = '30'] = process.argv.slice(2);
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith(ORIGINS[which]));
  const out = await page.evaluate((px, py) => {
    const hit = document.elementFromPoint(px, py);
    if (!hit) return 'nothing there';
    const root = hit.closest('a, button') || hit;
    const r1 = (n) => Math.round(n * 10) / 10;
    const lines = [`root <${root.tagName.toLowerCase()} class="${String(root.className).slice(0, 80)}"> href=${root.getAttribute('href') || '-'} aria="${root.getAttribute('aria-label') || ''}"`];
    lines.push(root.outerHTML.replace(/\s+/g, ' ').slice(0, 600));
    for (const el of [root, ...root.querySelectorAll('*')]) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const cs = getComputedStyle(el);
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
      lines.push(`<${el.tagName.toLowerCase()}.${String(el.className.baseVal ?? el.className).split(/\s+/).slice(0, 2).join('.')}> [${[r.x, r.y, r.width, r.height].map(r1).join(',')}] pad ${cs.padding} mar ${cs.margin} | ${cs.fontSize}/${cs.lineHeight} w${cs.fontWeight} ${cs.color} fvs ${cs.fontVariationSettings} ls ${cs.letterSpacing} bg ${cs.backgroundColor} r ${cs.borderRadius}${own ? ` "${own}"` : ''}`);
    }
    return lines.join('\n');
  }, Number(x), Number(y));
  console.log(out);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
