/**
 * Willow's "Scroll to bottom" arrow against Gemini's numbers, in a browser context of its own
 * (empty storage, a stand-in key) with Gemini's API answered here: a long reply makes a thread
 * to scroll, then the arrow is read at rest, hovered, focused and pressed, and the threshold is
 * walked. `stream` sends a second prompt answered slowly, to see the arrow stay away while a
 * reply comes in and return when the user scrolls up.
 *
 *   node tools/scratch/willow-scroll-fab.cjs [desktop|tablet|phone] [--stream]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const BASE = process.env.WILLOW_URL || 'http://localhost:3101';
const SIZES = {
  desktop: { width: 1536, height: 826 },
  tablet: { width: 800, height: 1280, mobile: true },
  phone: { width: 390, height: 844, mobile: true },
};
const OUT = 'tools/ui-research/captures/gemini/scroll-to-bottom/willow';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const LONG = Array.from({ length: 40 }, (_, i) => `**Part ${i + 1}.** The lighthouse keeper counted the ships again, because counting kept the night from feeling as long as it was, and the sea answered with the same slow breathing it had kept up for a hundred years.`).join('\n\n');
const sse = (text) => `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }] })}\r\n\r\n`;

/*
 * The debug Chrome cannot open new connections to the Tailwind CDN or Google Fonts at the
 * moment (ERR_TIMED_OUT), while Node can: those requests are fetched here and answered with
 * what came back, headers and all.
 */
const viaNode = new Map();
const answerViaNode = async (request) => {
  const url = request.url();
  try {
    if (!viaNode.has(url)) {
      viaNode.set(url, (async () => {
        const response = await fetch(url, { headers: { 'user-agent': request.headers()['user-agent'] || 'Mozilla/5.0' }, redirect: 'follow' });
        const headers = {};
        response.headers.forEach((value, key) => { if (!/^(content-encoding|content-length|transfer-encoding|connection)$/i.test(key)) headers[key] = value; });
        headers['access-control-allow-origin'] = '*';
        return { status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) };
      })());
    }
    const answer = await viaNode.get(url);
    await request.respond(answer);
  } catch (error) {
    await request.abort().catch(() => {});
  }
};

const fabInfo = (page) => page.evaluate(() => {
  const r2 = (n) => Math.round(n * 10) / 10;
  const box = (el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(r2); };
  const fab = document.querySelector('.gm-back-to-bottom__button');
  const scroller = [...document.querySelectorAll('*')].filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 200)
    .sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
  const pill = document.querySelector('[data-willow-composer-box], .chat-composer-box') || fab?.closest('.gm-back-to-bottom')?.parentElement;
  if (!fab) return { fab: null };
  const cs = getComputedStyle(fab);
  const icon = fab.querySelector('.google-symbols');
  const ics = icon && getComputedStyle(icon);
  const pillBox = pill && box(pill);
  return {
    viewport: `${innerWidth}x${innerHeight}`,
    cls: fab.className,
    box: box(fab),
    bg: cs.backgroundColor,
    color: cs.color,
    shadow: cs.boxShadow,
    opacity: cs.opacity,
    transform: cs.transform,
    outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} offset ${cs.outlineOffset}`,
    tabindex: fab.getAttribute('tabindex'),
    ariaHidden: fab.getAttribute('aria-hidden'),
    icon: icon && { text: icon.textContent, box: box(icon), font: ics.fontFamily, size: ics.fontSize, weight: ics.fontWeight, fvs: ics.fontVariationSettings, color: ics.color },
    pill: pillBox,
    gapToPill: pillBox ? r2(pillBox[1] - (fab.getBoundingClientRect().bottom)) : null,
    centreOffset: pillBox ? r2((fab.getBoundingClientRect().left + 20) - (pillBox[0] + pillBox[2] / 2)) : null,
    fromEnd: scroller ? Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop) : null,
  };
});

const scrollFromEnd = (page, by) => page.evaluate((px) => {
  const scroller = [...document.querySelectorAll('*')].filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 200)
    .sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
  scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight - px;
  return Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop);
}, by);

(async () => {
  const kind = SIZES[process.argv[2]] ? process.argv[2] : 'desktop';
  const streamTest = process.argv.includes('--stream');
  const size = SIZES[kind];
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 90_000 });
  // A window of its own in the profile's default context, on the test origin: fresh contexts
  // of this debug Chrome have no route to the internet (no Tailwind, no fonts).
  const MARK = '#willow-fab-probe';
  const opener = await browser.target().createCDPSession();
  const { targetId } = await opener.send('Target.createTarget', { url: 'about:blank', newWindow: true });
  const { windowId } = await opener.send('Browser.getWindowForTarget', { targetId });
  await opener.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
  let target = null;
  for (let i = 0; i < 50 && !target; i += 1) {
    target = browser.targets().find((t) => t._targetId === targetId);
    if (!target) await sleep(100);
  }
  const context = { close: () => opener.send('Target.closeTarget', { targetId }).catch(() => {}) };
  let slowReply = null;
  try {
    const page = await target.page();
    page.on('pageerror', (error) => console.log(`  [pageerror] ${error.message.slice(0, 200)}`));
    page.on('requestfailed', (request) => {
      if (/tailwind|gstatic|googleapis\.com\/css/.test(request.url())) console.log(`  [requestfailed] ${request.url().slice(0, 100)} ${request.failure()?.errorText}`);
    });
    page.on('response', (response) => {
      if (/cdn\.tailwindcss\.com/.test(response.url())) console.log(`  [response] ${response.status()} ${response.url().slice(0, 100)}`);
    });
    await page.evaluateOnNewDocument((origin) => {
      if (location.origin !== origin) return;
      if (!localStorage.getItem('willow:apiKeys:guest')) localStorage.setItem('willow:apiKeys:guest', JSON.stringify({ gemini: ['zz-not-a-real-key'], openai: [], anthropic: [] }));
    }, new URL(BASE).origin);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (/^https:\/\/(cdn\.tailwindcss\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//.test(url)) { void answerViaNode(request); return; }
      if (!/generativelanguage\.googleapis\.com/.test(url)) { void request.continue(); return; }
      if (request.method() === 'OPTIONS') { void request.respond({ status: 204, headers: CORS, body: '' }); return; }
      if (/\/interactions/.test(url)) { void request.respond({ status: 404, headers: CORS, contentType: 'application/json', body: '{}' }); return; }
      if (/:streamGenerateContent/.test(url)) {
        const raw = request.postData() || '';
        if (/keep going slowly/i.test(raw) && slowReply) { slowReply(request); return; }
        void request.respond({ status: 200, headers: CORS, contentType: 'text/event-stream', body: sse(LONG) });
        return;
      }
      void request.respond({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Lighthouse Story' }] }, finishReason: 'STOP' }] }) });
    });
    const cdp = await page.createCDPSession();
    if (size.mobile) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 0, mobile: true, screenWidth: size.width, screenHeight: size.height });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else {
      await page.setViewport({ width: size.width, height: size.height });
    }
    await page.bringToFront();
    await page.goto(`${BASE}/app${MARK}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForSelector('textarea', { visible: true, timeout: 120_000 });
    await sleep(3000);
    await page.focus('textarea');
    await page.keyboard.type('Tell me a long story', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Part 40\./.test(document.body.innerText), { timeout: 60_000 });
    // The reveal types the reply out; wait for it to settle.
    await page.waitForFunction(() => !document.querySelector('[data-streaming="true"]'), { timeout: 60_000 }).catch(() => {});
    await sleep(9000);

    console.log('at the end:', JSON.stringify(await fabInfo(page)));
    for (const px of [150, 190, 200, 210, 215, 220, 225, 230, 260]) {
      await scrollFromEnd(page, px);
      await sleep(450);
      const info = await fabInfo(page);
      console.log(`from the end ${px}: ${info.cls.includes('is-visible') ? 'shown' : 'hidden'} (fromEnd ${info.fromEnd})`);
    }
    await scrollFromEnd(page, 600);
    await sleep(800);
    const rest = await fabInfo(page);
    console.log('at rest:', JSON.stringify(rest, null, 1));
    await page.screenshot({ path: path.join(OUT, `${kind}-rest.png`) });
    const [x, y, w, h] = rest.box;
    await page.screenshot({ path: path.join(OUT, `${kind}-rest-zoom.png`), clip: { x: x - 24, y: y - 24, width: w + 48, height: h + 48 } });

    // Raw CDP moves: puppeteer's own did not register :hover here.
    const moveTo = async (px, py) => {
      for (let i = 1; i <= 6; i += 1) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py - (6 - i) * 4, button: 'none', pointerType: 'mouse' });
        await sleep(30);
      }
    };
    if (!size.mobile) {
      // Read again: the sidebar can settle (and move the column) after the first read.
      const [hx, hy, hw, hh] = (await fabInfo(page)).box;
      await moveTo(hx + hw / 2, hy + hh / 2);
      await sleep(400);
      console.log('hovered:', JSON.stringify((await fabInfo(page)).bg));
      await page.screenshot({ path: path.join(OUT, `${kind}-hover-zoom.png`), clip: { x: hx - 24, y: hy - 24, width: hw + 48, height: hh + 48 } });
      await moveTo(hx + hw / 2, hy - 150);
      await sleep(300);
      await page.focus('textarea');
      await page.keyboard.down('Shift');
      await page.keyboard.press('Tab');
      await page.keyboard.up('Shift');
      await sleep(300);
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      console.log('Shift+Tab from the composer lands on:', focused, JSON.stringify((await fabInfo(page)).outline));
    }

    // Press: the arrow leaves on its short fade and the thread glides to the end.
    await page.evaluate(() => {
      const fab = document.querySelector('.gm-back-to-bottom__button');
      window.__frames = [];
      const t0 = performance.now();
      const sample = () => {
        const cs = getComputedStyle(fab);
        const scroller = [...document.querySelectorAll('*')].filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 200)
          .sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
        window.__frames.push({ t: Math.round(performance.now() - t0), end: Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop), opacity: Number(cs.opacity).toFixed(3), cls: fab.className.replace('gm-back-to-bottom__button', '').trim() });
        if (window.__frames.length < 120) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const now = await fabInfo(page);
    console.log('before the press:', JSON.stringify({ box: now.box, cls: now.cls, fromEnd: now.fromEnd }));
    await page.screenshot({ path: path.join(OUT, `${kind}-before-press.png`) });
    const [cx, cy] = [now.box[0] + now.box[2] / 2, now.box[1] + now.box[3] / 2];
    if (size.mobile) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
      await sleep(60);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await moveTo(cx, cy);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
    }
    await sleep(1600);
    const frames = await page.evaluate(() => window.__frames);
    let last = '';
    for (const f of frames) {
      const key = `${f.opacity} ${f.cls} ${f.end === 0}`;
      if (key !== last) { console.log('  ', JSON.stringify(f)); last = key; }
    }
    console.log('after the glide:', JSON.stringify(await fabInfo(page)).slice(0, 200));

    if (streamTest) {
      // A reply that comes in over a few seconds, in pieces.
      slowReply = (request) => {
        const chunks = Array.from({ length: 12 }, (_, i) => sse(`${LONG.split('\n\n').slice(i * 3, i * 3 + 3).join('\n\n')}\n\n`));
        void request.respond({ status: 200, headers: CORS, contentType: 'text/event-stream', body: chunks.join('') });
      };
      await page.focus('textarea');
      await page.keyboard.type('Keep going slowly', { delay: 10 });
      await page.keyboard.press('Enter');
      const watch = [];
      for (let i = 0; i < 24; i += 1) {
        await sleep(500);
        const info = await fabInfo(page);
        watch.push(`${i * 500}ms ${info.cls.includes('is-visible') ? 'shown' : 'hidden'} fromEnd ${info.fromEnd}`);
        if (i === 10) {
          await page.evaluate(() => {
            const scroller = [...document.querySelectorAll('*')].filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 200)
              .sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
            scroller.scrollTop -= 400;
          });
          watch.push('  scrolled up 400px');
        }
      }
      console.log('while a reply comes in:\n  ' + watch.join('\n  '));
    }
  } finally {
    await context.close();
    browser.disconnect();
  }
})().catch((error) => { console.error(error); process.exit(1); });
