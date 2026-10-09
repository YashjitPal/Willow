/**
 * Read-only: which element scrolls Gemini's /images page once the template grid is open, and
 * how its scrollbar is drawn (overflow, scrollbar-gutter, scrollbar-width/-color, the
 * ::-webkit-scrollbar rules that reach it, and the gutter it takes). Opens its own tab.
 *
 *   node tools/scratch/gemini-images-scroller.cjs [desktop|tablet|phone]
 */
const puppeteer = require('puppeteer-core');

const SIZES = { desktop: { width: 1536, height: 826 }, tablet: { width: 800, height: 1280, mobile: true }, phone: { width: 390, height: 844, mobile: true } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SCAN = () => {
  const round = (v) => Math.round(v * 10) / 10;
  const label = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${String(el.className || '').split(' ').filter(Boolean).slice(0, 4).join('.')}`;
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (!/(auto|scroll|overlay)/.test(cs.overflowY)) continue;
    if (el.scrollHeight <= el.clientHeight + 1) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 100 || r.height < 100) continue;
    out.push({
      el: label(el),
      chain: (() => { const names = []; for (let p = el.parentElement; p && names.length < 5; p = p.parentElement) names.push(label(p).slice(0, 50)); return names; })(),
      rect: [r.x, r.y, r.width, r.height].map(round),
      overflowY: cs.overflowY,
      overflowX: cs.overflowX,
      gutter: cs.scrollbarGutter,
      width: cs.scrollbarWidth,
      color: cs.scrollbarColor,
      scrollbar: el.offsetWidth - el.clientWidth - (parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth)),
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      containsPage: el.contains(document.querySelector('discovery-images-page')),
    });
  }
  const rules = [];
  const walk = (list) => {
    for (const rule of list) {
      if (rule.cssRules && !(rule instanceof CSSStyleRule)) { walk(rule.cssRules); continue; }
      if (rule instanceof CSSStyleRule && /scrollbar|scroll-container|content-container|content-wrapper|chat-history|infinite-scroller/.test(rule.selectorText + rule.style.cssText)) {
        if (/scrollbar|overflow|gutter/.test(rule.style.cssText) || /::-webkit-scrollbar/.test(rule.selectorText)) rules.push(rule.cssText.slice(0, 400));
      }
    }
  };
  for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch { /* cross-origin */ } }
  const page = document.querySelector('discovery-images-page');
  const chain = [];
  for (let el = page; el && chain.length < 14; el = el.parentElement) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    chain.push(`${label(el).slice(0, 70)} [${[r.x, r.y, r.width, r.height].map(round)}] ov:${cs.overflowX}/${cs.overflowY} gutter:${cs.scrollbarGutter} sw:${cs.scrollbarWidth} pos:${cs.position} h:${el.scrollHeight}/${el.clientHeight}`);
  }
  return { scrollers: out, chain, rules: [...new Set(rules)].slice(0, 60) };
};

(async () => {
  const kind = SIZES[process.argv[2]] ? process.argv[2] : 'desktop';
  const size = SIZES[kind];
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 90_000 });
  const page = await browser.newPage();
  try {
    if (size.mobile) {
      const cdp = await page.createCDPSession();
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 0, mobile: true, screenWidth: size.width, screenHeight: size.height });
    } else {
      await page.setViewport({ width: size.width, height: size.height });
    }
    await page.bringToFront();
    await page.goto('https://gemini.google.com/images', { waitUntil: 'networkidle2', timeout: 90_000 });
    await page.waitForSelector('see-more-image-card', { timeout: 30_000 });
    await sleep(3500);
    const before = await page.evaluate(SCAN);
    console.log('BEFORE scrollers:', JSON.stringify(before.scrollers, null, 1));
    await page.evaluate(() => document.querySelector('see-more-image-card .see-more-card, see-more-image-card')?.click());
    await sleep(2500);
    const after = await page.evaluate(SCAN);
    console.log('AFTER scrollers:', JSON.stringify(after.scrollers, null, 1));
    console.log('chain from discovery-images-page up:\n  ' + after.chain.join('\n  '));
    console.log('scrollbar rules:\n  ' + after.rules.join('\n  '));
  } finally {
    await page.close().catch(() => {});
    browser.disconnect();
  }
})().catch((error) => { console.error(error); process.exit(1); });
