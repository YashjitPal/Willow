/**
 * Lists the CSS animations / transitions running under a selector on the Gemini (default)
 * or Willow tab, with their keyframes and timing, after bringing the tab to the front.
 * Pass --reload to reload first so entrance animations are caught from the start.
 *
 *   node tools/scratch/animations-of.cjs "<selector>" [--willow] [--reload] [--delay=ms]
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const args = process.argv.slice(2);
  const selector = args.find((a) => !a.startsWith('--')) || 'body';
  const onWillow = args.includes('--willow');
  const reload = args.includes('--reload');
  const delay = Number((args.find((a) => a.startsWith('--delay=')) || '--delay=0').slice(8));
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const pages = await browser.pages();
  const page = pages.find((p) => (onWillow ? (p.url().startsWith('http://localhost:3000') && !p.url().includes('/media')) && !p.url().includes('/media') : p.url().startsWith('https://gemini.google.com')));
  await page.bringToFront();
  if (reload) await page.reload({ waitUntil: 'domcontentloaded' });
  const found = await page.waitForSelector(selector, { timeout: 20000 }).then(() => true, () => false);
  if (!found) { console.log('selector not found'); browser.disconnect(); return; }
  if (delay) await new Promise((r) => setTimeout(r, delay));
  const out = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    const label = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : ''}`;
    return root.getAnimations({ subtree: true }).map((a) => {
      const effect = a.effect;
      const timing = effect?.getComputedTiming?.() || {};
      return {
        target: effect?.target ? label(effect.target) : '?',
        name: a.animationName || a.transitionProperty || a.constructor.name,
        state: a.playState,
        current: a.currentTime,
        duration: timing.duration,
        delay: timing.delay,
        easing: effect?.getTiming?.().easing,
        keyframes: effect?.getKeyframes?.().map((k) => { const { offset, easing, composite, computedOffset, ...rest } = k; return `${computedOffset}:${JSON.stringify(rest)}${easing && easing !== 'linear' ? ` ${easing}` : ''}`; }),
      };
    });
  }, selector);
  for (const a of out) {
    console.log(`${a.target}  ${a.name} ${a.state} t=${Math.round(a.current)} dur=${a.duration} delay=${a.delay} easing=${a.easing}`);
    for (const k of a.keyframes || []) console.log(`    ${k}`);
  }
  if (!out.length) console.log('no animations');
  browser.disconnect();
})();
