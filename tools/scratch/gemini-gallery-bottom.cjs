/**
 * Read-only: how far Gemini's creation-tool gallery scrolls. For each tool (image, video,
 * music) it picks the tool in a new chat (Upload & tools > Create …), scrolls the gallery to
 * its end, and measures the scroller, the gallery shell, the last card and the prompt box —
 * how much space is left under the last row. Nothing is sent; the tab is its own and closed.
 *
 *   node tools/scratch/gemini-gallery-bottom.cjs [desktop|tablet|phone] [image,video,music] [out-dir]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const SIZES = {
  desktop: { width: 1536, height: 826 },
  tablet: { width: 800, height: 1280, mobile: true },
  phone: { width: 390, height: 844, mobile: true },
};
const LABELS = { image: 'Create image', video: 'Create video', music: 'Create music' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MEASURE = () => {
  const round = (v) => Math.round(v * 10) / 10;
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(round); };
  const label = (el) => `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ').filter(Boolean).slice(0, 3).join('.')}`;
  const cards = [...document.querySelectorAll('media-gen-template-card')].filter((el) => el.getBoundingClientRect().width > 0);
  const last = cards.at(-1) ?? null;
  const shell = document.querySelector('media-gen-zero-state-shell');
  let scroller = null;
  for (let el = (last || shell)?.parentElement; el; el = el.parentElement) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) { scroller = el; break; }
  }
  const composer = [...document.querySelectorAll('input-area-v2, .input-area-container, fieldset.input-area-container')].find((el) => el.getBoundingClientRect().width > 0) ?? null;
  const s = scroller?.getBoundingClientRect();
  const l = last?.getBoundingClientRect();
  const c = composer?.getBoundingClientRect();
  const chain = [];
  for (let el = last; el && el !== scroller?.parentElement && chain.length < 10; el = el.parentElement) {
    const cs = getComputedStyle(el);
    chain.push(`${label(el)} [${box(el)}] pad:${cs.padding} margin:${cs.margin}${cs.minHeight !== '0px' && cs.minHeight !== 'auto' ? ` minH:${cs.minHeight}` : ''}`);
  }
  // What lies under the last row, inside the scroller.
  const below = scroller && l
    ? [...scroller.querySelectorAll('*')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.height > 0 && r.top >= l.bottom - 1 && !last.contains(el); })
      .slice(0, 12)
      .map((el) => `${label(el)} [${box(el)}]`)
    : [];
  return {
    viewport: [innerWidth, innerHeight],
    cards: cards.length,
    scroller: scroller ? {
      el: label(scroller),
      rect: box(scroller),
      scrollTop: round(scroller.scrollTop),
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      padding: getComputedStyle(scroller).padding,
      atEnd: Math.abs(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop) < 2,
    } : null,
    shell: shell ? { rect: box(shell), padding: getComputedStyle(shell).padding, margin: getComputedStyle(shell).margin } : null,
    lastCard: box(last),
    composer: box(composer),
    gaps: {
      lastCardToScrollerBottom: s && l ? round(s.bottom - l.bottom) : null,
      lastCardToComposerTop: c && l ? round(c.top - l.bottom) : null,
      scrollerBottomToComposerTop: c && s ? round(c.top - s.bottom) : null,
    },
    chain,
    below,
  };
};

(async () => {
  const [kindArg, toolsArg, outArg] = process.argv.slice(2);
  const kind = SIZES[kindArg] ? kindArg : 'desktop';
  const size = SIZES[kind];
  const tools = (toolsArg || 'image,video,music').split(',');
  const out = outArg || 'tools/ui-research/captures/gemini/media-tools-2026/gallery-bottom';
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 90_000 });
  const page = await browser.newPage();
  try {
    const cdp = await page.createCDPSession();
    if (size.mobile) {
      const version = (await browser.version()).match(/\/(\d+)/)?.[1] || '150';
      await cdp.send('Emulation.setUserAgentOverride', {
        userAgent: `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0${kind === 'phone' ? ' Mobile' : ''} Safari/537.36`,
      });
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 0, mobile: true, screenWidth: size.width, screenHeight: size.height });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else {
      await page.setViewport({ width: size.width, height: size.height });
    }
    const results = {};
    for (const tool of tools) {
      await page.bringToFront();
      await page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle2', timeout: 90_000 });
      await sleep(4000);
      const opened = await page.evaluate(() => {
        const button = [...document.querySelectorAll('button')]
          .find((el) => el.getBoundingClientRect().width > 0 && /upload & tools|tools/i.test(el.getAttribute('aria-label') || ''));
        button?.click();
        return button?.getAttribute('aria-label') ?? null;
      });
      await sleep(1200);
      const picked = await page.evaluate((text) => {
        const item = [...document.querySelectorAll('button, [role="menuitem"], [role="menuitemcheckbox"], [role="option"]')]
          .filter((el) => el.getBoundingClientRect().width > 0)
          .find((el) => (el.textContent || '').replace(/\s+/g, ' ').trim().startsWith(text));
        item?.click();
        return item ? item.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : null;
      }, LABELS[tool]);
      console.log(`\n== ${tool} (${kind}): menu ${opened} → ${picked}`);
      await page.waitForSelector('media-gen-template-card', { timeout: 20_000 });
      // The prompt box takes a while to settle into its docked place; measure after it has.
      await sleep(Number(process.env.SETTLE_MS) || 3000);
      const toEnd = () => page.evaluate(() => {
        const card = document.querySelector('media-gen-template-card');
        for (let el = card?.parentElement; el; el = el.parentElement) {
          if (/(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1) { el.scrollTop = el.scrollHeight; break; }
        }
      });
      await toEnd();
      await sleep(1500);
      await toEnd();
      await sleep(800);
      const measured = await page.evaluate(MEASURE);
      results[tool] = measured;
      console.log(JSON.stringify({ cards: measured.cards, scroller: measured.scroller, shell: measured.shell, lastCard: measured.lastCard, composer: measured.composer, gaps: measured.gaps }));
      console.log('  chain:\n    ' + measured.chain.join('\n    '));
      console.log('  below the last row:\n    ' + (measured.below.join('\n    ') || '(nothing)'));
      await page.bringToFront();
      await page.screenshot({ path: path.join(out, `${kind}-${tool}-end.png`) });
    }
    fs.writeFileSync(path.join(out, `${kind}.json`), JSON.stringify(results, null, 1));
  } finally {
    await page.close().catch(() => {});
    browser.disconnect();
  }
})().catch((error) => { console.error(error); process.exit(1); });
