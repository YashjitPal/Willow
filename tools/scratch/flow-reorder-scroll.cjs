// Does Flow's Scenebuilder timeline scroll by itself while a clip is dragged to its edge? In a
// window of its own (marked #willow-scene-probe: #willow-probe is other agents' too) on a test
// scene: zoom in until the clips run past the timeline, drag the last clip to the timeline's left
// edge and hold it there, sampling the scroll; then bring it back over its own slot before
// letting go, so the scene's order is left as it was. The window is closed at the end.
//   node tools/scratch/flow-reorder-scroll.cjs <sceneUrl>
const puppeteer = require('puppeteer-core');

const MARK = '#willow-scene-probe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const url = process.argv[2];
  if (!/^https:\/\/flow\.google\.com\/project\/[^/]+\/scene\//.test(url || '')) throw new Error('give a Flow scene URL');
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const session = await browser.target().createCDPSession();
  const { targetId } = await session.send('Target.createTarget', { url: `${url}${MARK}`, newWindow: true });
  let cdp = null;
  try {
    const { windowId } = await session.send('Browser.getWindowForTarget', { targetId });
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
    let page = null;
    for (let i = 0; i < 40 && !page; i += 1) {
      await sleep(250);
      page = (await browser.pages()).find((p) => p.url().includes(MARK)) ?? null;
    }
    if (!page) throw new Error('the probe window did not open');
    await sleep(10000);
    cdp = await page.createCDPSession();
    const mouse = (type, x, y, buttons = 0) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'mouse' });
    for (let i = 0; i < 60 && (await page.evaluate(() => document.querySelectorAll('flow-scene-timeline .clip').length)) < 2; i += 1) await sleep(500);
    const info = () => page.evaluate(() => {
      const clips = [...document.querySelectorAll('flow-scene-timeline .timeline-contents > .clip')].map((c) => { const r = c.getBoundingClientRect(); return { x: Math.round(r.left), w: Math.round(r.width), y: Math.round(r.top + r.height / 2), cls: c.className.replace(/cdk-drag|mat-context-menu-trigger/g, '').trim() }; });
      // The element that scrolls the timeline sideways.
      let el = document.querySelector('flow-scene-timeline .timeline-contents');
      while (el && !(el.scrollWidth > el.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowX))) el = el.parentElement;
      const r = el?.getBoundingClientRect();
      return { clips, scroller: el ? `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}` : null, scrollLeft: el ? Math.round(el.scrollLeft) : null, scrollWidth: el?.scrollWidth, clientWidth: el?.clientWidth, left: r ? Math.round(r.left) : null, preview: !!document.querySelector('.cdk-drag-preview') };
    });
    let s = await info();
    console.log('start', JSON.stringify(s));
    // Zoom in until the clips are wider than the timeline.
    for (let i = 0; i < 6 && !(s.scroller); i += 1) {
      const zin = await page.evaluate(() => { const b = document.querySelector('flow-scene-timeline button[aria-label="Zoom in"]'); if (!b || b.disabled) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      if (!zin) break;
      await mouse('mouseMoved', zin.x, zin.y);
      await mouse('mousePressed', zin.x, zin.y, 1);
      await mouse('mouseReleased', zin.x, zin.y);
      await sleep(700);
      s = await info();
    }
    console.log('zoomed', JSON.stringify(s));
    if (!s.scroller) throw new Error('the timeline never got wider than its area');
    // Show the last clip: scroll to the far right.
    await page.evaluate(() => {
      let el = document.querySelector('flow-scene-timeline .timeline-contents');
      while (el && !(el.scrollWidth > el.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowX))) el = el.parentElement;
      if (el) el.scrollLeft = el.scrollWidth;
    });
    await sleep(600);
    s = await info();
    const last = s.clips[s.clips.length - 1];
    const startX = Math.max(s.left + 200, last.x + 60);
    console.log('before drag', JSON.stringify({ scrollLeft: s.scrollLeft, last, startX }));
    await mouse('mouseMoved', startX, last.y);
    await mouse('mousePressed', startX, last.y, 1);
    const edgeX = s.left + 12;
    for (let i = 1; i <= 25; i += 1) {
      await mouse('mouseMoved', startX + ((edgeX - startX) * i) / 25, last.y + Math.min(i, 3) * 2, 1);
      await sleep(30);
    }
    const samples = [];
    for (let i = 0; i < 10; i += 1) {
      await sleep(300);
      await mouse('mouseMoved', edgeX + (i % 2), last.y + 6, 1);
      const x = await info();
      samples.push({ t: (i + 1) * 300, scrollLeft: x.scrollLeft, preview: x.preview });
    }
    console.log('held at the left edge:', JSON.stringify(samples));
    // Back over its own slot, then let go: the order stays as it was.
    s = await info();
    const home = s.clips.find((c) => /cdk-drag-placeholder/.test(c.cls)) || s.clips[s.clips.length - 1];
    await page.evaluate(() => {
      let el = document.querySelector('flow-scene-timeline .timeline-contents');
      while (el && !(el.scrollWidth > el.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowX))) el = el.parentElement;
      if (el) el.scrollLeft = el.scrollWidth;
    });
    await sleep(400);
    s = await info();
    const lastNow = s.clips[s.clips.length - 1];
    for (let i = 1; i <= 20; i += 1) {
      await mouse('mouseMoved', edgeX + ((lastNow.x + 60 - edgeX) * i) / 20, last.y + 6, 1);
      await sleep(30);
    }
    await sleep(500);
    await mouse('mouseReleased', lastNow.x + 60, last.y + 6);
    await sleep(1200);
    console.log('after release', JSON.stringify(await info()), 'placeholder seen during hold:', JSON.stringify(home));
  } finally {
    await cdp?.detach().catch(() => {});
    await session.send('Target.closeTarget', { targetId }).catch(() => {});
    await browser.disconnect();
  }
})().catch((e) => { console.error(e); process.exit(1); });
