/**
 * Willow's sent-image preview, measured the way `gemini-sent-image.cjs` measures Gemini's. In
 * a browser context of its own, with Gemini's API answered here: sends a 1024x571 JPEG named
 * image_2ddbdb.jpg (the reference image's size and name) through the composer, presses it in
 * the thread, and records the preview — its boxes, the animations it starts, the More options
 * menu — then closes it with Close and checks the thumbnail is back.
 *
 *   node tools/scratch/willow-sent-image.cjs [desktop|tablet|phone] [out-dir]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const SIZES = {
  desktop: { width: 1536, height: 826 },
  tablet: { width: 800, height: 1280, mobile: true },
  phone: { width: 390, height: 844, mobile: true },
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const IMAGE = path.resolve('tools/scratch/image_2ddbdb.jpg');

const sse = (text) => `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }] })}\r\n\r\n`;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

const MEASURE = () => {
  const round = (v) => Math.round(v * 100) / 100;
  const box = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height].map(round);
  };
  const img = document.querySelector('.gm-sent-viewer__img');
  const name = document.querySelector('.gm-sent-viewer__name');
  const nameCs = name ? getComputedStyle(name) : null;
  return {
    viewport: [innerWidth, innerHeight],
    header: box('.gm-sent-viewer__header'),
    close: box('.gm-sent-viewer__back'),
    glyph: box('.gm-sent-viewer__name-row > span:first-child'),
    title: box('.gm-sent-viewer__name'),
    titleFont: nameCs ? `${nameCs.fontSize}/${nameCs.lineHeight} ${nameCs.fontWeight} ${nameCs.color}` : null,
    more: box('.gm-sent-viewer__more'),
    image: box('.gm-sent-viewer__img'),
    natural: img ? [img.naturalWidth, img.naturalHeight] : null,
    backdrop: (() => { const el = document.querySelector('.gm-sent-viewer__backdrop'); if (!el) return null; const cs = getComputedStyle(el); return `${cs.backgroundColor} ${cs.backdropFilter}`; })(),
    mesh: (() => { const el = document.querySelector('.gm-sent-viewer__mesh'); return el ? getComputedStyle(el).backgroundColor : null; })(),
  };
};

const RECORD = (ms) => {
  const t0 = performance.now();
  const seen = new Set();
  window.__record = { animations: [], done: false };
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
        delay: timing.delay,
        duration: timing.duration,
        easing: timing.easing,
        keyframes: effect?.getKeyframes?.().map(({ offset, easing, opacity, transform }) => ({ offset, easing, opacity, transform })),
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
  const out = outArg || `tools/ui-research/captures/gemini/sent-image/willow-${kind}`;
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60_000 });
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => console.log(`  [pageerror] ${error.message.slice(0, 200)}`));
    await page.evaluateOnNewDocument(() => {
      if (location.origin !== 'http://localhost:3000') return;
      if (!localStorage.getItem('willow:apiKeys:guest')) localStorage.setItem('willow:apiKeys:guest', JSON.stringify({ gemini: ['zz-not-a-real-key'], openai: [], anthropic: [] }));
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (!/generativelanguage\.googleapis\.com/.test(url)) { void request.continue(); return; }
      if (request.method() === 'OPTIONS') { void request.respond({ status: 204, headers: CORS, body: '' }); return; }
      if (/\/interactions/.test(url)) { void request.respond({ status: 404, headers: CORS, contentType: 'application/json', body: '{}' }); return; }
      if (/:streamGenerateContent/.test(url)) { void request.respond({ status: 200, headers: CORS, contentType: 'text/event-stream', body: sse('A quiet otter in a concrete gallery.') }); return; }
      void request.respond({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Reference Image' }] }, finishReason: 'STOP' }] }) });
    });
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
    await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea', { visible: true, timeout: 90_000 });
    await sleep(3000);

    // The reference image's size and name, drawn here.
    if (!fs.existsSync(IMAGE)) {
      const data = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 571;
        const ctx = canvas.getContext('2d');
        const sky = ctx.createLinearGradient(0, 0, 1024, 571);
        sky.addColorStop(0, '#5d7377');
        sky.addColorStop(1, '#2b3433');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, 1024, 571);
        ctx.fillStyle = '#c9c6bd';
        for (let i = 0; i < 7; i += 1) ctx.fillRect(80 + i * 130, 120 + (i % 3) * 30, 70, 360);
        ctx.fillStyle = '#8a6f56';
        ctx.beginPath();
        ctx.ellipse(512, 330, 60, 140, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f0ede6';
        ctx.font = '600 44px sans-serif';
        ctx.fillText('HAPPY TIMEZONE', 600, 200);
        return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
      });
      fs.writeFileSync(IMAGE, Buffer.from(data, 'base64'));
    }
    const input = await page.$('input[type="file"][multiple]');
    await input.uploadFile(IMAGE);
    await sleep(1500);
    await page.focus('textarea');
    await page.keyboard.type('Here is my reference image.', { delay: 15 });
    await page.keyboard.press('Enter');
    const tile = '[role="button"][title="image_2ddbdb.jpg"]';
    await page.waitForSelector(tile, { visible: true, timeout: 30_000 });
    await sleep(3000);
    await page.evaluate((selector) => document.querySelector(selector)?.scrollIntoView({ block: 'center' }), tile);
    await sleep(600);
    await page.screenshot({ path: path.join(out, 'thread.png') });
    const thumb = await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { rect: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100), radius: cs.borderRadius, cursor: cs.cursor };
    }, tile);
    console.log('thumbnail:', JSON.stringify(thumb));

    // Open, recording what starts.
    const centre = { x: thumb.rect[0] + thumb.rect[2] / 2, y: thumb.rect[1] + thumb.rect[3] / 2 };
    await page.evaluate(RECORD, 900);
    if (size.mobile) await page.touchscreen.tap(centre.x, centre.y);
    else await page.mouse.click(centre.x, centre.y);
    await page.waitForFunction(() => window.__record?.done, { timeout: 10_000 });
    const opened = await page.evaluate(() => window.__record.animations);
    console.log('\nopen animations:');
    for (const a of opened.filter((entry) => /sent-viewer|opacity|backdrop/.test(`${entry.name} ${entry.target}`))) {
      console.log(`  +${a.seenAt}ms ${a.name} on ${a.target} | ${a.duration}ms delay ${a.delay} ${a.easing} | ${JSON.stringify(a.keyframes)}`);
    }
    await sleep(500);
    console.log('\npreview:', JSON.stringify(await page.evaluate(MEASURE)));
    console.log('thumbnail while open:', await page.evaluate((selector) => getComputedStyle(document.querySelector(selector)).opacity, tile));
    console.log('focused:', await page.evaluate(() => document.activeElement?.getAttribute('aria-label')));
    await page.screenshot({ path: path.join(out, 'preview.png') });

    // More options.
    if (size.mobile) {
      const more = await page.evaluate(() => { const r = document.querySelector('.gm-sent-viewer__more').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await page.touchscreen.tap(more.x, more.y);
    } else {
      await page.click('.gm-sent-viewer__more');
    }
    await sleep(500);
    console.log('menu:', JSON.stringify(await page.evaluate(() => {
      const panel = document.querySelector('.gm-sent-viewer__menu');
      const item = panel?.querySelector('.gm-sent-viewer__menu-item');
      if (!panel || !item) return null;
      const pr = panel.getBoundingClientRect();
      const ir = item.getBoundingClientRect();
      const rel = (el) => { const r = el.getBoundingClientRect(); return [r.x - ir.x, r.y - ir.y, r.width, r.height].map((v) => Math.round(v * 10) / 10); };
      const cs = getComputedStyle(panel);
      return {
        panel: [pr.x, pr.y, pr.width, pr.height].map((v) => Math.round(v * 10) / 10),
        item: [ir.x, ir.y, ir.width, ir.height].map((v) => Math.round(v * 10) / 10),
        icon: rel(item.querySelector('span')),
        label: rel(item.querySelectorAll('span')[1]),
        bg: cs.backgroundColor,
        backdrop: cs.backdropFilter,
        radius: cs.borderRadius,
        text: item.textContent,
      };
    })));
    await page.screenshot({ path: path.join(out, 'preview-menu.png') });
    await page.keyboard.press('Escape');
    await sleep(300);
    console.log('Escape with the menu open → menu closed:', await page.evaluate(() => !document.querySelector('.gm-sent-viewer__menu')), '| viewer still open:', await page.evaluate(() => !!document.querySelector('.gm-sent-viewer')));

    // A click on the dark area does nothing, as in Gemini.
    if (size.mobile) await page.touchscreen.tap(20, size.height - 20);
    else await page.mouse.click(20, size.height - 20);
    await sleep(300);
    console.log('after a click on the dark area, open:', await page.evaluate(() => !!document.querySelector('.gm-sent-viewer')));

    // Close.
    if (size.mobile) {
      const back = await page.evaluate(() => { const r = document.querySelector('.gm-sent-viewer__back').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await page.touchscreen.tap(back.x, back.y);
    } else {
      await page.click('.gm-sent-viewer__back');
    }
    await sleep(40);
    const midClose = await page.evaluate(() => {
      const viewer = document.querySelector('.gm-sent-viewer');
      return viewer ? `${viewer.className} content opacity ${getComputedStyle(document.querySelector('.gm-sent-viewer__content')).opacity}` : 'gone';
    });
    await sleep(300);
    console.log('40ms into closing:', midClose, '| then open:', await page.evaluate(() => !!document.querySelector('.gm-sent-viewer')),
      '| thumbnail opacity:', await page.evaluate((selector) => getComputedStyle(document.querySelector(selector)).opacity, tile));
  } finally {
    await context.close();
    browser.disconnect();
  }
})().catch((error) => { console.error(error); process.exit(1); });
