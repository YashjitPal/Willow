/**
 * Willow's /images page, measured the way `gemini-images-more.cjs` measures Gemini's: where
 * the hero, the composer and the templates sit before and after the 2x2 tile opens the grid
 * (does anything move sideways when the scrollbar arrives?), and every animation the tile and
 * the grid's Close card start, with each card's opacity frame by frame. A browser context of
 * its own; nothing is sent.
 *
 *   node tools/scratch/willow-images-more.cjs [desktop|tablet|phone] [out-dir]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const SIZES = {
  desktop: { width: 1536, height: 826 },
  // A desktop window at tablet width: a mouse, so the 12px scrollbar is a real one.
  narrow: { width: 900, height: 800 },
  tablet: { width: 800, height: 1280, mobile: true },
  phone: { width: 390, height: 844, mobile: true },
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const LAYOUT = () => {
  const round = (v) => Math.round(v * 10) / 10;
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(round); };
  const first = (selector) => [...document.querySelectorAll(selector)].find((el) => el.getBoundingClientRect().width > 0) ?? null;
  const page = document.querySelector('.gm-images-page');
  const scroller = page?.closest('.gemini-chat-scrollbar') ?? null;
  const cs = scroller ? getComputedStyle(scroller) : null;
  const centre = (b) => (b ? round(b[0] + b[2] / 2) : null);
  const hero = box(first('.gm-images-hero__title'));
  const composer = box(first('textarea')?.closest('.willow-gemini-composer, [data-composer-shell]') ?? first('textarea'));
  const layout = box(first('.gm-images-carousel, .gm-images-grid'));
  return {
    scroller: scroller ? {
      gutter: cs.scrollbarGutter,
      offsetWidth: scroller.offsetWidth,
      clientWidth: scroller.clientWidth,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
    } : null,
    hero,
    composer,
    layout,
    centres: { hero: centre(hero), composer: centre(composer), layout: centre(layout) },
    firstCard: box(first('.gm-images-card')),
    cards: document.querySelectorAll('.gm-images-card').length,
  };
};

const RECORD = (ms) => {
  const t0 = performance.now();
  const seen = new Set();
  const frames = [];
  window.__record = { animations: [], frames, done: false };
  const tick = () => {
    const now = performance.now() - t0;
    for (const animation of document.getAnimations()) {
      if (seen.has(animation)) continue;
      seen.add(animation);
      const effect = animation.effect;
      const timing = effect?.getTiming?.() ?? {};
      const target = effect?.target;
      window.__record.animations.push({
        seenAt: Math.round(now),
        name: animation.animationName || animation.transitionProperty || '',
        target: target ? `${target.tagName.toLowerCase()}.${String(target.className || '').split(' ').slice(0, 2).join('.')}` : '',
        duration: timing.duration,
        delay: timing.delay,
        easing: timing.easing,
        keyframes: effect?.getKeyframes?.().map(({ offset, easing, opacity, transform }) => ({ offset, easing, opacity, transform })),
      });
    }
    if (!frames.length || now - frames[frames.length - 1].t >= 16) {
      const layout = document.querySelector('.gm-images-grid, .gm-images-carousel');
      frames.push({
        t: Math.round(now),
        layout: layout ? `${layout.className.split(' ')[0]} o${Number(getComputedStyle(layout).opacity).toFixed(2)}` : null,
        cards: document.querySelectorAll('.gm-images-card').length,
      });
    }
    if (now < ms) requestAnimationFrame(tick);
    else window.__record.done = true;
  };
  requestAnimationFrame(tick);
};

(async () => {
  const [kindArg, outArg] = process.argv.slice(2);
  const kind = SIZES[kindArg] ? kindArg : 'desktop';
  const size = SIZES[kind];
  const out = outArg || `tools/ui-research/captures/gemini/media-tools-2026/images-more/willow-${kind}`;
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60_000 });
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => console.log(`  [pageerror] ${error.message.slice(0, 200)}`));
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
    await page.bringToFront();
    await page.goto(`${BASE}/images`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.gm-images-more', { visible: true, timeout: 90_000 });
    await sleep(3000);
    const before = await page.evaluate(LAYOUT);
    console.log('before:', JSON.stringify(before));
    await page.screenshot({ path: path.join(out, 'before.png') });

    const press = async (selector, label) => {
      const frames = [];
      cdp.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
        frames.push({ data, at: metadata.timestamp });
        await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
      await sleep(300);
      const target = await page.evaluate((sel) => {
        const el = [...document.querySelectorAll(sel)].find((node) => node.getBoundingClientRect().width > 0);
        if (!el) return null;
        // Centred: at the bottom edge a phone's docked composer is over it.
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, selector);
      if (!target) throw new Error(`nothing matches ${selector}`);
      await page.bringToFront();
      if (size.mobile) {
        await page.evaluate(RECORD, 1200);
        await page.touchscreen.tap(target.x, target.y);
      } else {
        await page.mouse.move(target.x, target.y);
        await sleep(300);
        await page.evaluate(RECORD, 1200);
        await page.mouse.down();
        await page.mouse.up();
      }
      const clickedAt = Date.now() / 1000;
      await page.waitForFunction(() => window.__record?.done, { timeout: 10_000 });
      await cdp.send('Page.stopScreencast');
      cdp.removeAllListeners('Page.screencastFrame');
      const record = await page.evaluate(() => window.__record);
      const dir = path.join(out, `${label}-frames`);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      frames.forEach((frame, index) => {
        fs.writeFileSync(path.join(dir, `${String(index).padStart(3, '0')}_${Math.round((frame.at - clickedAt) * 1000)}ms.jpg`), Buffer.from(frame.data, 'base64'));
      });
      console.log(`\n== ${label}: ${record.animations.length} animations`);
      for (const animation of record.animations) {
        console.log(`  +${animation.seenAt}ms ${animation.name} on ${animation.target} | ${animation.duration}ms delay ${animation.delay} ${animation.easing} | ${JSON.stringify(animation.keyframes)}`);
      }
      let previous = '';
      for (const frame of record.frames) {
        const line = `${frame.layout} cards ${frame.cards}`;
        if (line !== previous) console.log(`  ${String(frame.t).padStart(4)}ms ${line}`);
        previous = line;
      }
      const opacities = record.frames.filter((frame) => frame.layout).map((frame) => `${frame.t}:${frame.layout.split(' o')[1]}`);
      console.log('  opacity:', opacities.filter((_, index) => index % 3 === 0).join(' '));
    };

    await press('.gm-images-more', 'open');
    const after = await page.evaluate(LAYOUT);
    console.log('\nafter open:', JSON.stringify(after));
    await page.screenshot({ path: path.join(out, 'after-open.png') });
    await press('.gm-images-close', 'close');
    console.log('\nafter close:', JSON.stringify(await page.evaluate(LAYOUT)));
  } finally {
    await context.close();
    browser.disconnect();
  }
})().catch((error) => { console.error(error); process.exit(1); });
