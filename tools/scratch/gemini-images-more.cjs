/**
 * Read-only: what Gemini's /images page does when its 2x2 "see more" tile is pressed, and
 * when the grid's Close card is. Opens the page in a tab of its own and records, for each:
 *
 *  - every animation and transition the press starts (`document.getAnimations()`: keyframes,
 *    duration, delay, easing, fill), with the element it runs on;
 *  - each template card's box, opacity and transform on every frame for 1.8s;
 *  - the page's scroll container before and after (overflow, scrollbar-gutter, scrollbar
 *    width, where the hero and the composer sit), to see whether anything moves sideways
 *    when the scrollbar arrives;
 *  - a screencast of the motion.
 *
 *   node tools/scratch/gemini-images-more.cjs [desktop|tablet|phone] [out-dir]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const SIZES = {
  desktop: { width: 1536, height: 826 },
  tablet: { width: 800, height: 1280, mobile: true },
  phone: { width: 390, height: 844, mobile: true },
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* In the page: the scroll container around the templates, and what moves when it scrolls. */
const LAYOUT = () => {
  const round = (v) => Math.round(v * 10) / 10;
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(round); };
  const page = document.querySelector('discovery-images-page');
  const scrollers = [];
  for (let el = page; el; el = el.parentElement) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll|overlay)/.test(cs.overflowY) || el === document.scrollingElement) {
      scrollers.push({
        el: `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ').slice(0, 3).join('.')}`,
        overflowY: cs.overflowY,
        gutter: cs.scrollbarGutter,
        width: cs.scrollbarWidth,
        color: cs.scrollbarColor,
        offsetWidth: el.offsetWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        scrollTop: round(el.scrollTop),
      });
    }
  }
  const first = (selector) => [...document.querySelectorAll(selector)].find((el) => el.getBoundingClientRect().width > 0);
  return {
    viewport: [innerWidth, innerHeight],
    scrollers,
    hero: box(first('discovery-images-page h1, discovery-images-page .title, page-header h1')),
    composer: box(first('input-area-v2, .input-area-container')),
    carousel: box(first('carousel-image-layout')),
    grid: box(first('grid-image-layout')),
    cards: document.querySelectorAll('discovery-images-page image-card').length,
    firstCard: box(first('discovery-images-page image-card')),
  };
};

/* In the page: watch animations and card boxes from now for `ms`. */
const RECORD = (ms) => {
  const t0 = performance.now();
  const seen = new Map();
  const frames = [];
  const describe = (el) => {
    if (!el || !el.tagName) return String(el);
    const index = el.parentElement ? [...el.parentElement.children].indexOf(el) : -1;
    const host = el.closest('image-card, see-more-image-card, close-image-card, grid-image-layout, carousel-image-layout, discovery-images-page');
    return `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ').filter(Boolean).slice(0, 3).join('.')}[${index}]${host && host !== el ? ` in ${host.tagName.toLowerCase()}` : ''}`;
  };
  const cardBoxes = () => [...document.querySelectorAll('discovery-images-page image-card, discovery-images-page see-more-image-card, discovery-images-page [class*="close"]')]
    .filter((el) => el.getBoundingClientRect().width > 0)
    .slice(0, 40)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const inner = el.firstElementChild || el;
      const cs = getComputedStyle(el);
      const ics = getComputedStyle(inner);
      return [el.tagName.toLowerCase().slice(0, 6), Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), Number(cs.opacity).toFixed(2), cs.transform === 'none' ? '' : cs.transform, Number(ics.opacity).toFixed(2), ics.transform === 'none' ? '' : ics.transform];
    });
  window.__record = { animations: [], frames, visibility: document.visibilityState, errors: [] };
  let lastTick = 0;
  const tick = () => {
    const now = performance.now() - t0;
    lastTick = now;
    try {
      step(now);
    } catch (error) {
      window.__record.errors.push(String(error?.message || error));
    }
    if (now < ms) requestAnimationFrame(tick);
    else window.__record.done = true;
  };
  // A hidden tab gets no animation frames; fall back to timers so the record still ends.
  const watchdog = setInterval(() => {
    const now = performance.now() - t0;
    if (window.__record.done) { clearInterval(watchdog); return; }
    if (now - lastTick > 100) {
      window.__record.errors.push(`no animation frame for ${Math.round(now - lastTick)}ms (${document.visibilityState})`);
      try { step(now); } catch { /* recorded above */ }
      lastTick = now;
    }
    if (now >= ms + 200) { window.__record.done = true; clearInterval(watchdog); }
  }, 50);
  const step = (now) => {
    for (const animation of document.getAnimations()) {
      if (seen.has(animation)) continue;
      const effect = animation.effect;
      const timing = effect?.getTiming?.() ?? {};
      seen.set(animation, true);
      window.__record.animations.push({
        seenAt: Math.round(now),
        type: animation.constructor.name,
        name: animation.animationName || animation.transitionProperty || animation.id || '',
        target: describe(effect?.target),
        keyframes: effect?.getKeyframes?.().map((frame) => {
          const { composite, computedOffset, ...rest } = frame;
          return rest;
        }),
        delay: timing.delay,
        duration: timing.duration,
        easing: timing.easing,
        fill: timing.fill,
        iterations: timing.iterations,
        startTime: animation.startTime === null ? null : Math.round(animation.startTime - (performance.timeOrigin ? 0 : 0)),
      });
    }
    if (frames.length === 0 || now - frames[frames.length - 1].t >= 16) {
      const scroller = (() => {
        for (let el = document.querySelector('discovery-images-page'); el; el = el.parentElement) {
          if (el.scrollHeight > el.clientHeight + 1 && /(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY)) return el;
        }
        return null;
      })();
      frames.push({ t: Math.round(now), scrollTop: scroller ? Math.round(scroller.scrollTop) : null, clientWidth: scroller ? scroller.clientWidth : null, cards: cardBoxes() });
    }
  };
  requestAnimationFrame(tick);
};

(async () => {
  const [kindArg, outArg] = process.argv.slice(2);
  const kind = SIZES[kindArg] ? kindArg : 'desktop';
  const size = SIZES[kind];
  const out = outArg || `tools/ui-research/captures/gemini/media-tools-2026/images-more/${kind}`;
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 90_000 });
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  try {
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
    await page.goto('https://gemini.google.com/images', { waitUntil: 'networkidle2', timeout: 90_000 });
    await page.waitForSelector('see-more-image-card', { timeout: 30_000 });
    await sleep(4000);

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
        el.scrollIntoView({ block: 'nearest' });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, selector);
      if (!target) throw new Error(`nothing matches ${selector}`);
      await page.mouse.move(target.x, target.y);
      await sleep(400);
      await page.bringToFront();
      await page.evaluate(RECORD, 1800);
      const clickedAt = Date.now() / 1000;
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForFunction(() => window.__record?.done, { timeout: 10_000 });
      await sleep(300);
      await cdp.send('Page.stopScreencast');
      cdp.removeAllListeners('Page.screencastFrame');
      const record = await page.evaluate(() => window.__record);
      const dir = path.join(out, `${label}-frames`);
      fs.mkdirSync(dir, { recursive: true });
      frames.forEach((frame, index) => {
        const ms = Math.round((frame.at - clickedAt) * 1000);
        fs.writeFileSync(path.join(dir, `${String(index).padStart(3, '0')}_${ms}ms.jpg`), Buffer.from(frame.data, 'base64'));
      });
      fs.writeFileSync(path.join(out, `${label}.json`), JSON.stringify(record, null, 1));
      console.log(`\n== ${label}: ${record.animations.length} animations, ${record.frames.length} samples, ${frames.length} screencast frames (${record.visibility}${record.errors.length ? `; ${record.errors.slice(0, 3).join(' | ')}` : ''})`);
      for (const animation of record.animations.slice(0, 60)) {
        console.log(`  +${animation.seenAt}ms ${animation.type} ${animation.name} on ${animation.target} | delay ${animation.delay} dur ${animation.duration} ${animation.easing} fill ${animation.fill} | ${JSON.stringify(animation.keyframes).slice(0, 220)}`);
      }
      return record;
    };

    await press('see-more-image-card', 'open');
    const after = await page.evaluate(LAYOUT);
    console.log('\nafter open:', JSON.stringify(after));
    await page.screenshot({ path: path.join(out, 'after-open.png') });
    const html = await page.evaluate(() => document.querySelector('grid-image-layout')?.outerHTML.slice(0, 20000) ?? null);
    fs.writeFileSync(path.join(out, 'grid.html'), html || '');

    const closeSelector = await page.evaluate(() => {
      const grid = document.querySelector('grid-image-layout');
      const last = grid ? [...grid.querySelectorAll('*')].reverse().find((el) => /close/i.test(el.textContent || '') && el.getBoundingClientRect().width > 50) : null;
      if (!last) return null;
      last.setAttribute('data-willow-close', '1');
      return '[data-willow-close="1"]';
    });
    if (closeSelector) {
      await press(closeSelector, 'close');
      console.log('\nafter close:', JSON.stringify(await page.evaluate(LAYOUT)));
    } else {
      console.log('no Close card found');
    }
  } finally {
    await page.close().catch(() => {});
    browser.disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
