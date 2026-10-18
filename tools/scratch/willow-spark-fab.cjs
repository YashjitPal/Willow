/**
 * The "Scroll to bottom" arrow in Willow's Spark task view, against Gemini's numbers: in a window
 * of its own on the test origin, two tasks are seeded through the app's own spark-store and
 * deleted again at the end.
 *
 *   long      a prompt and a 40-part reply: the arrow at rest, the threshold, hover, focus, press
 *   reserve   the same with a short follow-up, whose anchored area is held open below it: being
 *             far from the scroller's end with no content below must not show the arrow
 *
 * Refuses to seed if the origin has a writable folder connected (tasks sync to Spark/Tasks).
 *
 *   WILLOW_URL=http://localhost:3101 node tools/scratch/willow-spark-fab.cjs [desktop|tablet|phone]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const BASE = process.env.WILLOW_URL || 'http://localhost:3101';
if (/:3000\b/.test(BASE)) throw new Error(':3000 holds the user\'s own Willow; use the test origin');
const SIZES = {
  desktop: { width: 1536, height: 826 },
  tablet: { width: 800, height: 1280, mobile: true },
  phone: { width: 390, height: 844, mobile: true },
};
const OUT = 'tools/ui-research/captures/gemini/scroll-to-bottom/willow';
const IDS = { long: 'seed-fab-long', reserve: 'seed-fab-reserve' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const LONG = Array.from({ length: 40 }, (_, i) => `**Part ${i + 1}.** The lighthouse keeper counted the ships again, because counting kept the night from feeling as long as it was, and the sea answered with the same slow breathing it had kept up for a hundred years.`).join('\n\n');

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
    await request.respond(await viaNode.get(url));
  } catch {
    await request.abort().catch(() => {});
  }
};

const folderConnected = (page) => page.evaluate(async () => {
  try {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('WillowLocalFS', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    if (!db.objectStoreNames.contains('handles')) return false;
    const record = await new Promise((resolve) => { const q = db.transaction('handles', 'readonly').objectStore('handles').get('local_projects_dir'); q.onsuccess = () => resolve(q.result); q.onerror = () => resolve(null); });
    const root = record && (record.handle || record);
    return Boolean(root && await root.queryPermission({ mode: 'readwrite' }) === 'granted');
  } catch {
    return false;
  }
});

const state = (page) => page.evaluate(() => {
  const r2 = (n) => Math.round(n * 10) / 10;
  const box = (el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(r2); };
  const fab = document.querySelector('.spark-task-detail__followup-composer .gm-back-to-bottom__button');
  const scroller = document.querySelector('.spark-task-detail__conversation-scroll');
  const composer = document.querySelector('.spark-task-detail__followup-composer');
  const pill = composer?.querySelector('.willow-gemini-composer');
  if (!fab || !scroller) return { fab: !!fab, scroller: !!scroller };
  const cs = getComputedStyle(fab);
  const icon = fab.querySelector('.google-symbols');
  const ics = icon && getComputedStyle(icon);
  const f = fab.getBoundingClientRect();
  const p = pill?.getBoundingClientRect();
  const c = composer?.getBoundingClientRect();
  return {
    viewport: `${innerWidth}x${innerHeight}`,
    visible: fab.classList.contains('is-visible'),
    cls: fab.className.replace('gm-back-to-bottom__button', '').trim(),
    box: box(fab),
    bg: cs.backgroundColor,
    color: cs.color,
    shadow: cs.boxShadow,
    outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} offset ${cs.outlineOffset}`,
    icon: icon && `${icon.textContent} ${ics.fontSize} ${ics.fontWeight} ${ics.color}`,
    pill: pill && box(pill),
    gapToPill: p ? r2(p.top - f.bottom) : null,
    offFromPillCentre: p ? r2((f.left + f.width / 2) - (p.left + p.width / 2)) : null,
    offFromComposerCentre: c ? r2((f.left + f.width / 2) - (c.left + c.width / 2)) : null,
    fromEnd: Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop),
    inset: getComputedStyle(scroller).paddingBottom,
  };
});

const scrollFromEnd = (page, by) => page.evaluate((px) => {
  const scroller = document.querySelector('.spark-task-detail__conversation-scroll');
  scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight - px;
  return Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop);
}, by);

const seed = (page, kind) => page.evaluate(async (id, kindName, long) => {
  // The app's live instance of the module: the newest load of it on the resource timeline.
  const url = performance.getEntriesByType('resource')
    .filter((entry) => /\/spark-store\.ts(\?|$)/.test(entry.name))
    .sort((a, b) => b.startTime - a.startTime)[0]?.name;
  if (!url) return { error: 'spark-store not loaded' };
  const store = await import(url);
  if (!store.sparkState.get().tasks.some((task) => task.id === id)) {
    store.createSparkTask('Tell me a long story about a lighthouse keeper.', {
      id,
      title: kindName === 'reserve' ? 'Lighthouse Log (follow-up)' : 'Lighthouse Log',
      description: 'A long story',
      status: 'complete',
      openTask: false,
      response: long,
      progressLabel: 'Done',
      turns: kindName === 'reserve'
        ? [{ id: `${id}-turn-1`, prompt: 'Give it a title', response: '**The Keeper Who Counted Ships.**', createdAt: new Date().toISOString() }]
        : [],
    });
  }
  store.navigateSpark({ page: 'task', taskId: id });
  return { opened: id };
}, IDS[kind], kind, LONG);

const clear = (page) => page.evaluate(async (ids) => {
  const url = performance.getEntriesByType('resource')
    .filter((entry) => /\/spark-store\.ts(\?|$)/.test(entry.name))
    .sort((a, b) => b.startTime - a.startTime)[0]?.name;
  const removed = [];
  if (url) {
    const store = await import(url);
    for (const id of ids) if (store.deleteSparkTask(id)) removed.push(id);
  }
  let leftovers = 0;
  for (const key of Object.keys(localStorage)) {
    if (/^willow:spark:task:v\d+:/.test(key) && /seed-fab-/.test(key)) { localStorage.removeItem(key); leftovers += 1; continue; }
    if (!/^willow:spark:v\d+:/.test(key)) continue;
    try {
      const value = JSON.parse(localStorage.getItem(key));
      if (!Array.isArray(value?.tasks)) continue;
      const before = value.tasks.length;
      value.tasks = value.tasks.filter((task) => !/^seed-fab-/.test(String(task.id)));
      if (value.tasks.length !== before) { leftovers += before - value.tasks.length; localStorage.setItem(key, JSON.stringify(value)); }
    } catch {}
  }
  return { removed, leftovers };
}, Object.values(IDS));

(async () => {
  const kind = SIZES[process.argv[2]] ? process.argv[2] : 'desktop';
  const size = SIZES[kind];
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 90_000 });
  const opener = await browser.target().createCDPSession();
  const { targetId } = await opener.send('Target.createTarget', { url: 'about:blank', newWindow: true });
  const { windowId } = await opener.send('Browser.getWindowForTarget', { targetId });
  await opener.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
  let target = null;
  for (let i = 0; i < 50 && !target; i += 1) {
    target = browser.targets().find((t) => t._targetId === targetId);
    if (!target) await sleep(100);
  }
  const page = await target.page();
  let seeded = false;
  try {
    page.on('pageerror', (error) => console.log(`  [pageerror] ${error.message.slice(0, 200)}`));
    await page.evaluateOnNewDocument(() => performance.setResourceTimingBufferSize(5000));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (/^https:\/\/(cdn\.tailwindcss\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//.test(request.url())) { void answerViaNode(request); return; }
      void request.continue();
    });
    const cdp = await page.createCDPSession();
    if (size.mobile) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 0, mobile: true, screenWidth: size.width, screenHeight: size.height });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else {
      await page.setViewport({ width: size.width, height: size.height });
    }
    await page.bringToFront();
    await page.goto(`${BASE}/spark/tasks#willow-spark-fab-probe`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(() => performance.getEntriesByType('resource').some((entry) => /\/spark-store\.ts(\?|$)/.test(entry.name)), { timeout: 120_000 });
    await sleep(3000);
    if (await folderConnected(page)) throw new Error('a writable folder is connected on this origin; not seeding');

    // The long reply: lands at the end, so hidden; up from there, the threshold and every state.
    seeded = true;
    console.log(JSON.stringify(await seed(page, 'long')));
    await page.waitForSelector('.spark-task-detail__conversation-scroll', { timeout: 30_000 });
    await sleep(3500);
    console.log('opened:', JSON.stringify(await state(page)));
    for (const px of [150, 190, 200, 210, 215, 220, 225, 230, 260]) {
      await scrollFromEnd(page, px);
      await sleep(450);
      const s = await state(page);
      console.log(`from the end ${px}: ${s.visible ? 'shown' : 'hidden'} (fromEnd ${s.fromEnd})`);
    }
    await scrollFromEnd(page, 600);
    await sleep(800);
    const rest = await state(page);
    console.log('at rest:', JSON.stringify(rest, null, 1));
    await page.screenshot({ path: path.join(OUT, `spark-${kind}-rest.png`) });
    const [x, y, w, h] = rest.box;
    await page.screenshot({ path: path.join(OUT, `spark-${kind}-rest-zoom.png`), clip: { x: x - 24, y: y - 24, width: w + 48, height: h + 48 } });

    const moveTo = async (px, py) => {
      for (let i = 1; i <= 6; i += 1) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py - (6 - i) * 4, button: 'none', pointerType: 'mouse' });
        await sleep(30);
      }
    };
    if (!size.mobile) {
      const [hx, hy, hw, hh] = (await state(page)).box;
      await moveTo(hx + hw / 2, hy + hh / 2);
      await sleep(400);
      console.log('hovered:', JSON.stringify((await state(page)).bg));
      await moveTo(hx + hw / 2, hy - 150);
      await sleep(300);
      await page.focus('.spark-task-detail__followup-composer textarea');
      await page.keyboard.down('Shift');
      await page.keyboard.press('Tab');
      await page.keyboard.up('Shift');
      await sleep(300);
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      console.log('Shift+Tab from the composer lands on:', focused, JSON.stringify((await state(page)).outline));
    }

    await page.evaluate(() => {
      const fab = document.querySelector('.spark-task-detail__followup-composer .gm-back-to-bottom__button');
      const scroller = document.querySelector('.spark-task-detail__conversation-scroll');
      window.__frames = [];
      const t0 = performance.now();
      const sample = () => {
        window.__frames.push({ t: Math.round(performance.now() - t0), end: Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop), opacity: Number(getComputedStyle(fab).opacity).toFixed(3), cls: fab.className.replace('gm-back-to-bottom__button', '').trim() });
        if (window.__frames.length < 120) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const now = await state(page);
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
    let last = '';
    for (const f of await page.evaluate(() => window.__frames)) {
      const key = `${f.opacity} ${f.cls} ${f.end === 0}`;
      if (key !== last) { console.log('  ', JSON.stringify(f)); last = key; }
    }
    const after = await state(page);
    console.log('after the glide:', JSON.stringify({ visible: after.visible, fromEnd: after.fromEnd }));

    // A short follow-up, anchored with its area held open: far from the end is not enough.
    console.log(JSON.stringify(await seed(page, 'reserve')));
    await sleep(3500);
    const opened = await state(page);
    console.log('reserve, opened:', JSON.stringify({ visible: opened.visible, fromEnd: opened.fromEnd }));
    for (const px of [150, 300, 450, 900, 1500]) {
      await scrollFromEnd(page, px);
      await sleep(450);
      const s = await state(page);
      const below = await page.evaluate(() => {
        const scroller = document.querySelector('.spark-task-detail__conversation-scroll');
        const turns = scroller.querySelectorAll('.spark-task-detail__conversation > article');
        const newest = turns[turns.length - 1];
        const bottom = Math.max(...[...newest.children]
          .filter((child) => !['absolute', 'fixed'].includes(getComputedStyle(child).position))
          .map((child) => child.getBoundingClientRect().bottom));
        return Math.round(bottom - (scroller.getBoundingClientRect().bottom - (parseFloat(getComputedStyle(scroller).paddingBottom) || 0)));
      });
      console.log(`reserve, from the end ${px}: ${s.visible ? 'shown' : 'hidden'} (fromEnd ${s.fromEnd}, content below the view ${below})`);
    }
  } finally {
    if (seeded) console.log('cleared:', JSON.stringify(await clear(page).catch((error) => ({ error: error.message }))));
    await opener.send('Target.closeTarget', { targetId }).catch(() => {});
    browser.disconnect();
  }
})().catch((error) => { console.error(error); process.exit(1); });
