/**
 * Willow's creation-tool gallery, measured as `gemini-gallery-bottom.cjs` measures Gemini's:
 * pick the tool (Upload & tools > Create …), scroll the gallery to its end, and measure the
 * space left under the last row — to the scroller's bottom edge and to the prompt box. A
 * browser context of its own; nothing is sent.
 *
 *   node tools/scratch/willow-gallery-bottom.cjs [desktop|narrow|tablet|phone] [image,video,music] [out-dir]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const SIZES = {
  desktop: { width: 1536, height: 826 },
  narrow: { width: 900, height: 800 },
  tablet: { width: 800, height: 1280, mobile: true },
  phone: { width: 390, height: 844, mobile: true },
};
const LABELS = { image: 'Create image', video: 'Create video', music: 'Create music' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MEASURE = () => {
  const round = (v) => Math.round(v * 10) / 10;
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(round); };
  const cards = [...document.querySelectorAll('.gm-gallery .gm-template')].filter((el) => el.getBoundingClientRect().width > 0);
  const last = cards.at(-1) ?? null;
  const gallery = document.querySelector('.gm-gallery');
  const scroller = gallery?.closest('.gemini-chat-scrollbar') ?? null;
  const composer = [...document.querySelectorAll('.willow-gemini-composer')].find((el) => el.getBoundingClientRect().width > 0) ?? null;
  const s = scroller?.getBoundingClientRect();
  const l = last?.getBoundingClientRect();
  const c = composer?.getBoundingClientRect();
  return {
    viewport: [innerWidth, innerHeight],
    cards: cards.length,
    scroller: scroller ? {
      rect: box(scroller),
      scrollTop: round(scroller.scrollTop),
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      padding: getComputedStyle(scroller).padding,
      atEnd: Math.abs(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop) < 2,
    } : null,
    gallery: gallery ? { rect: box(gallery), padding: getComputedStyle(gallery).padding } : null,
    grid: box(gallery?.querySelector('.gm-gallery__grid')),
    lastCard: box(last),
    composer: box(composer),
    gaps: {
      lastCardToScrollerBottom: s && l ? round(s.bottom - l.bottom) : null,
      lastCardToComposerTop: c && l ? round(c.top - l.bottom) : null,
      scrollerBottomToComposerTop: c && s ? round(c.top - s.bottom) : null,
    },
  };
};

(async () => {
  const [kindArg, toolsArg, outArg] = process.argv.slice(2);
  const kind = SIZES[kindArg] ? kindArg : 'desktop';
  const size = SIZES[kind];
  const tools = (toolsArg || 'image,video,music').split(',');
  const out = outArg || 'tools/ui-research/captures/gemini/media-tools-2026/gallery-bottom/willow';
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60_000 });
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => console.log(`  [pageerror] ${error.message.slice(0, 200)}`));
    if (size.mobile) {
      const cdp = await page.createCDPSession();
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
      await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('button[aria-label="Upload & tools"]', { visible: true, timeout: 90_000 });
      await sleep(2500);
      await page.click('button[aria-label="Upload & tools"]');
      await sleep(900);
      const picked = await page.evaluate((text) => {
        const item = [...document.querySelectorAll('button, [role="menuitem"], [role="menuitemcheckbox"], [role="option"]')]
          .filter((el) => el.getBoundingClientRect().width > 0)
          // An icon's ligature is text too ("image_createCreate image").
          .find((el) => (el.textContent || '').replace(/\s+/g, ' ').trim().endsWith(text));
        item?.click();
        return item ? item.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) : null;
      }, LABELS[tool]);
      console.log(`  picked: ${picked}`);
      try {
        await page.waitForSelector('.gm-gallery .gm-template', { timeout: 20_000 });
      } catch (error) {
        await page.screenshot({ path: path.join(out, `${kind}-${tool}-failed.png`) });
        console.log('  visible rows:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('button, [role="menuitem"]')]
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30))
          .filter(Boolean)
          .slice(0, 40))));
        throw error;
      }
      await sleep(2500);
      await page.evaluate(() => {
        const scroller = document.querySelector('.gm-gallery')?.closest('.gemini-chat-scrollbar');
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      });
      await sleep(1200);
      const measured = await page.evaluate(MEASURE);
      results[tool] = measured;
      console.log(`\n== ${tool} (${kind}): ${picked}`);
      console.log(JSON.stringify(measured));
      await page.bringToFront();
      await page.screenshot({ path: path.join(out, `${kind}-${tool}-end.png`) });
    }
    fs.writeFileSync(path.join(out, `${kind}.json`), JSON.stringify(results, null, 1));
  } finally {
    await context.close();
    browser.disconnect();
  }
})().catch((error) => { console.error(error); process.exit(1); });
