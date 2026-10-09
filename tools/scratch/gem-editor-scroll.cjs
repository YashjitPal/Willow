/**
 * Phone-size Gem editor: which parts stay put when the page scrolls 200px, in Gemini
 * (default) or Willow (--willow). Scrolls the nearest scrollable ancestor of the Name
 * field, prints positions before/after, then scrolls back. Read-only otherwise.
 */
const puppeteer = require('puppeteer-core');

const onWillow = process.argv.includes('--willow');
const PARTS = onWillow
  ? { title: '.gem-editor-mobile-title', saveRow: '.gem-editor-mobile-actions', tabs: '.gem-editor-tabs', name: '.gem-editor-field', legal: '.gem-editor-legal' }
  : { title: 'bots-creation-window .title-container', saveRow: 'bots-creation-window .action-buttons-container', tabs: 'bots-creation-window nav, bots-creation-window .mat-mdc-tab-nav-bar', name: 'bots-creation-window .name-input-container .mdc-text-field', legal: 'bots-creation-window .legal-consent' };

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => (onWillow ? p.url().startsWith('http://localhost:3000') && !p.url().includes('/media') : p.url().startsWith('https://gemini.google.com')));
  await page.bringToFront();
  console.log(await page.evaluate(async (parts) => {
    const ys = () => Object.fromEntries(Object.entries(parts).map(([k, s]) => {
      const el = [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().width > 0);
      return [k, el ? Math.round(el.getBoundingClientRect().y * 10) / 10 : null];
    }));
    const name = document.querySelector(parts.name);
    let scroller = name?.parentElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    if (!scroller) return 'no scroller';
    const before = ys();
    scroller.scrollTop += 200;
    await new Promise((r) => setTimeout(r, 300));
    const after = ys();
    scroller.scrollTop -= 200;
    const cs = getComputedStyle(scroller);
    const legal = document.querySelector(parts.legal);
    const lcs = legal ? getComputedStyle(legal) : null;
    return [
      `scroller ${scroller.tagName.toLowerCase()}.${String(scroller.className).split(' ').slice(0, 3).join('.')} [y ${Math.round(scroller.getBoundingClientRect().y)}, h ${Math.round(scroller.clientHeight)}] scrollH ${scroller.scrollHeight} pad ${cs.padding}`,
      ...Object.keys(parts).map((k) => `${k}: ${before[k]} -> ${after[k]}`),
      `legal position ${lcs?.position} bottom ${lcs?.bottom} parent ${legal?.parentElement?.className?.split(' ').slice(0, 2).join('.')}`,
    ].join('\n');
  }, PARTS));
  browser.disconnect();
})();
