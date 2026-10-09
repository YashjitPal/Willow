/*
 * Measures the composer's empty-state placeholder ("Ask Gemini" / "Ask Willow") in the
 * debug Chrome's Gemini and Willow tabs across a sweep of widths: type metrics of the
 * placeholder itself and where its text box sits.
 *
 *   node tools/scratch/placeholder-measure.cjs phone|tablet
 *
 * "phone" sweeps 390-768 with the phone user agent (no reload); "tablet" sweeps
 * 769-960 with the tablet agent (one reload of both tabs).
 */
const puppeteer = require('puppeteer-core');

const SWEEPS = { phone: [390, 480, 600, 700, 756, 768], tablet: [769, 800, 900, 960] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function read(app) {
  const round = (n) => Math.round(n * 100) / 100;
  const box = (el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(round); };
  const pick = (cs) => ({ size: cs.fontSize, lh: cs.lineHeight, weight: cs.fontWeight, fvs: cs.fontVariationSettings, ls: cs.letterSpacing, color: cs.color, family: cs.fontFamily.split(',')[0] });
  if (app === 'gemini') {
    const ed = document.querySelector('rich-textarea .ql-editor');
    if (!ed) return null;
    const cs = getComputedStyle(ed);
    const ph = getComputedStyle(ed, '::before');
    return { editor: box(ed), pad: [cs.paddingTop, cs.paddingLeft].join('/'), blank: ed.classList.contains('ql-blank'), placeholder: { ...pick(ph), content: ph.content, left: ph.left, top: ph.top, position: ph.position } };
  }
  const ta = document.querySelector('textarea[placeholder^="Ask"]');
  if (!ta) return null;
  const cs = getComputedStyle(ta);
  return { editor: box(ta), pad: [cs.paddingTop, cs.paddingLeft].join('/'), blank: !ta.value, placeholder: pick(getComputedStyle(ta, '::placeholder')), text: pick(cs) };
}

(async () => {
  const sweep = process.argv[2] || 'phone';
  const ua = sweep === 'tablet' ? 'tablet' : 'phone';
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  for (const width of SWEEPS[sweep]) {
    await fetch(`http://127.0.0.1:9339/set?w=${width}&h=${width > 768 ? 1280 : 844}&ua=${ua}`).then((r) => r.json());
    await sleep(width === SWEEPS[sweep][0] && sweep === 'tablet' ? 9000 : 1000);
    const pages = await browser.pages();
    for (const app of ['gemini', 'willow']) {
      const page = pages.find((p) => p.url().startsWith(app === 'gemini' ? 'https://gemini.google.com/' : 'http://localhost:3000/'));
      await page.waitForSelector(app === 'gemini' ? 'rich-textarea .ql-editor' : 'textarea[placeholder^="Ask"]', { timeout: 30000 }).catch(() => {});
      console.log(`${String(width).padStart(4)} ${app.padEnd(6)} ${JSON.stringify(await page.evaluate(read, app))}`);
    }
  }
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
